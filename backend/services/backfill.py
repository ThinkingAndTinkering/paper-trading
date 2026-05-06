"""Backfill historical daily snapshots from Yahoo Finance + transaction log.

Reconstructs end-of-day NAV for any trading day with no snapshot by:
  1. Replaying the transaction + cash log up to that day's close to get
     positions and cash.
  2. Looking up that day's close price (USD-converted via historical FX) for
     every ticker held.
  3. Computing NAV = cash + long_value - short_value.

After filling gaps, daily_return is recomputed across the full series so
gaps that previously inflated a day's return get corrected.
"""

import json
from collections import defaultdict
from datetime import date, datetime, timedelta

import pandas as pd
import yfinance as yf

from models import (
    CashTransaction,
    DailySnapshot,
    Portfolio,
    Transaction,
    get_session,
)
from services.pricing import _get_cached_info


def _currency_for(ticker: str) -> str:
    info = _get_cached_info(ticker)
    return (info.get("currency") or "USD").upper()


def _state_at(cash_txs, trades, cutoff_dt):
    """Replay logs up to cutoff. Returns (cash, total_deposits, longs, shorts)."""
    cash = 0.0
    total_deposits = 0.0
    longs = defaultdict(float)
    shorts = defaultdict(float)

    for ct in cash_txs:
        if ct.created_at > cutoff_dt:
            break
        if ct.action == "deposit":
            cash += ct.amount
            total_deposits += ct.amount
        elif ct.action == "withdraw":
            cash -= ct.amount
            total_deposits -= ct.amount

    for tx in trades:
        if tx.created_at > cutoff_dt:
            break
        if tx.action == "buy":
            longs[tx.ticker] += tx.shares
            cash -= tx.total_value
        elif tx.action == "sell":
            longs[tx.ticker] -= tx.shares
            cash += tx.total_value
        elif tx.action == "short":
            shorts[tx.ticker] += tx.shares
            cash += tx.total_value
        elif tx.action == "cover":
            shorts[tx.ticker] -= tx.shares
            cash -= tx.total_value

    return cash, total_deposits, longs, shorts


def _normalize_series(s: pd.Series) -> pd.Series:
    """Drop NaNs and normalize index to naive date Timestamps."""
    if s is None or s.empty:
        return pd.Series(dtype=float)
    s = s.dropna()
    idx = s.index
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
    s = s.copy()
    s.index = pd.DatetimeIndex([pd.Timestamp(x).normalize() for x in idx])
    return s


def _lookup_at_or_before(series, d: date):
    if series is None or len(series) == 0:
        return None
    ts = pd.Timestamp(d)
    try:
        if ts in series.index:
            v = series.loc[ts]
        else:
            valid = series.index[series.index <= ts]
            if len(valid) == 0:
                return None
            v = series.loc[valid[-1]]
        # Pandas may return a 1-element Series when `series` is a 1-col DataFrame.
        if hasattr(v, "iloc"):
            v = v.iloc[0]
        return float(v)
    except (TypeError, ValueError, IndexError):
        return None


# Plausible FX-rate bounds (XXXUSD=X, i.e. how many USD per 1 unit of foreign).
# JPY ≈ 0.0067, KRW ≈ 0.0007, INR ≈ 0.012 (low end). GBP ≈ 1.27, KWD ≈ 3.3 (high end).
# Anything outside [1e-5, 100] is clearly wrong and we'd rather refuse than fabricate.
_FX_MIN, _FX_MAX = 1e-5, 100.0


def _safe_fx(rate, ccy: str):
    if rate is None or not isfinite_safe(rate):
        return None
    if rate < _FX_MIN or rate > _FX_MAX:
        print(f"[backfill] WARNING implausible FX for {ccy}: {rate}; skipping")
        return None
    return rate


def isfinite_safe(x):
    try:
        import math
        return math.isfinite(float(x))
    except Exception:
        return False


def _fetch_close_panel(tickers, start_date, end_date):
    """Returns dict[ticker -> Series of date->close in local currency]."""
    panel = {}
    if not tickers:
        return panel
    try:
        df = yf.download(
            tickers=tickers,
            start=start_date,
            end=end_date + timedelta(days=1),
            auto_adjust=False,
            progress=False,
            group_by="ticker",
            threads=True,
        )
    except Exception as e:
        print(f"[backfill] yf.download failed: {e}")
        return {tk: pd.Series(dtype=float) for tk in tickers}

    for tk in tickers:
        try:
            if len(tickers) == 1:
                s = df["Close"] if "Close" in df.columns else pd.Series(dtype=float)
            else:
                s = df[tk]["Close"] if (tk in df.columns.get_level_values(0)) else pd.Series(dtype=float)
            panel[tk] = _normalize_series(s)
        except Exception:
            panel[tk] = pd.Series(dtype=float)
    return panel


def _fetch_fx_panel(currencies, start_date, end_date):
    """Returns dict[currency -> Series of date->rate to USD].

    Uses yf.Ticker(...).history() per currency rather than yf.download(),
    which has been flaky for FX pairs (returning equity close prices for
    unrelated tickers in some cases).
    """
    panel = {}
    for ccy in currencies:
        if ccy == "USD":
            continue
        rate_series = pd.Series(dtype=float)

        # Primary: XXXUSD=X (rate already in target form)
        try:
            t = yf.Ticker(f"{ccy}USD=X")
            df = t.history(
                start=start_date,
                end=end_date + timedelta(days=1),
                auto_adjust=False,
            )
            if df is not None and not df.empty and "Close" in df.columns:
                rate_series = _normalize_series(df["Close"])
        except Exception as e:
            print(f"[backfill] FX history fetch failed for {ccy}USD=X: {e}")

        # Fallback: USDXXX=X (invert)
        if rate_series.empty:
            try:
                t = yf.Ticker(f"USD{ccy}=X")
                df = t.history(
                    start=start_date,
                    end=end_date + timedelta(days=1),
                    auto_adjust=False,
                )
                if df is not None and not df.empty and "Close" in df.columns:
                    inv = _normalize_series(df["Close"])
                    if not inv.empty:
                        rate_series = 1.0 / inv
            except Exception as e:
                print(f"[backfill] FX history fetch failed for USD{ccy}=X: {e}")

        panel[ccy] = rate_series
    return panel


def backfill_snapshots(portfolio_id: int) -> dict:
    session = get_session()
    try:
        p = session.query(Portfolio).get(portfolio_id)
        if not p:
            return {"error": "Portfolio not found"}

        cash_txs = (
            session.query(CashTransaction)
            .filter_by(portfolio_id=portfolio_id)
            .order_by(CashTransaction.created_at.asc())
            .all()
        )
        trades = (
            session.query(Transaction)
            .filter_by(portfolio_id=portfolio_id)
            .order_by(Transaction.created_at.asc())
            .all()
        )

        if not cash_txs and not trades:
            return {"created": 0, "message": "No activity to backfill"}

        starts = []
        if cash_txs:
            starts.append(cash_txs[0].created_at.date())
        if trades:
            starts.append(trades[0].created_at.date())
        start_date = min(starts)
        end_date = date.today()  # exclusive: today is handled by live generate_snapshot

        ticker_set = sorted({tx.ticker for tx in trades})
        currencies = {tk: _currency_for(tk) for tk in ticker_set}
        unique_currencies = sorted(set(currencies.values()))

        price_panel = _fetch_close_panel(ticker_set, start_date, end_date)
        fx_panel = _fetch_fx_panel(unique_currencies, start_date, end_date)

        # Build the trading-date list: union of all price-series indices.
        trading_dates = set()
        for s in price_panel.values():
            for ts in s.index:
                trading_dates.add(ts.date())

        if not trading_dates:
            # No tickers (cash-only portfolio) — anchor to SPY for trading days
            try:
                anchor = yf.download(
                    "SPY",
                    start=start_date,
                    end=end_date + timedelta(days=1),
                    auto_adjust=False,
                    progress=False,
                )
                if not anchor.empty and "Close" in anchor.columns:
                    s = _normalize_series(anchor["Close"])
                    for ts in s.index:
                        trading_dates.add(ts.date())
            except Exception:
                pass

        if not trading_dates:
            # Fallback: weekdays
            cur = start_date
            while cur < end_date:
                if cur.weekday() < 5:
                    trading_dates.add(cur)
                cur += timedelta(days=1)

        trading_dates = sorted(d for d in trading_dates if start_date <= d < end_date)

        existing = {
            s.date: s
            for s in session.query(DailySnapshot)
            .filter_by(portfolio_id=portfolio_id)
            .all()
        }

        # Anchor each ticker's USD price to its first trade price. yfinance
        # batch downloads occasionally return wildly wrong values for non-USD
        # tickers (Korean, Canadian); we use the anchor to detect those
        # outliers (>50x deviation) and clamp to the last known good price.
        first_trade_price = {}
        for tx in trades:
            if tx.ticker not in first_trade_price and tx.action in ("buy", "short"):
                first_trade_price[tx.ticker] = tx.price
        last_good_usd = dict(first_trade_price)
        OUTLIER_FACTOR = 50.0

        created = 0
        updated = 0
        for d in trading_dates:
            cutoff_dt = datetime.combine(d, datetime.max.time())
            cash, total_deposits, longs, shorts = _state_at(cash_txs, trades, cutoff_dt)

            long_value = 0.0
            short_value = 0.0
            positions_detail = []

            def _value(side, holdings):
                nonlocal long_value, short_value
                for tk, sh in holdings.items():
                    if sh == 0:
                        continue
                    local = _lookup_at_or_before(price_panel.get(tk), d)
                    ccy = currencies.get(tk, "USD")

                    candidate = None
                    if local is not None:
                        if ccy == "USD":
                            candidate = local
                        else:
                            raw = _lookup_at_or_before(fx_panel.get(ccy), d)
                            fx = _safe_fx(raw, ccy)
                            if fx is not None:
                                candidate = local * fx

                    anchor = last_good_usd.get(tk)
                    price_usd = None
                    if candidate is not None and candidate > 0:
                        if anchor is None:
                            price_usd = candidate
                        elif (candidate > anchor * OUTLIER_FACTOR
                              or candidate < anchor / OUTLIER_FACTOR):
                            print(
                                f"[backfill] WARNING {tk} on {d}: "
                                f"candidate USD ${candidate:,.2f} vs anchor "
                                f"${anchor:,.2f} ({candidate/anchor:.2f}x); "
                                "using anchor"
                            )
                            price_usd = anchor
                        else:
                            price_usd = candidate
                            last_good_usd[tk] = candidate
                    elif anchor is not None:
                        # No data today (delisted, FX failure) — carry last good forward
                        price_usd = anchor

                    if price_usd is None:
                        continue

                    mv = sh * price_usd
                    if side == "long":
                        long_value += mv
                    else:
                        short_value += mv
                    positions_detail.append({
                        "ticker": tk,
                        "side": side,
                        "shares": sh,
                        "price": round(price_usd, 4),
                        "market_value": round(mv, 2),
                    })

            _value("long", longs)
            _value("short", shorts)

            nav = cash + long_value - short_value
            positions_json_str = json.dumps(positions_detail)

            row = existing.get(d)
            if row is None:
                row = DailySnapshot(
                    portfolio_id=portfolio_id,
                    date=d,
                    cash=cash,
                    long_value=long_value,
                    short_value=short_value,
                    net_value=nav,
                    total_deposits=total_deposits,
                    daily_return=None,  # recomputed below
                    positions_json=positions_json_str,
                )
                session.add(row)
                created += 1
            else:
                # Yahoo's historical close is ground truth for any past day —
                # overwrite whatever the live snapshot wrote (which can fall
                # back to cost basis when get_quotes silently fails).
                row.cash = cash
                row.long_value = long_value
                row.short_value = short_value
                row.net_value = nav
                row.total_deposits = total_deposits
                row.positions_json = positions_json_str
                updated += 1

        session.commit()

        # Recompute daily_return for the full series so prior gap-spanning
        # values get corrected after backfill.
        all_snaps = (
            session.query(DailySnapshot)
            .filter_by(portfolio_id=portfolio_id)
            .order_by(DailySnapshot.date.asc())
            .all()
        )
        prev = None
        for s in all_snaps:
            if prev is None or prev.net_value <= 0:
                s.daily_return = None
            else:
                net_flow = s.total_deposits - prev.total_deposits
                denom = prev.net_value + net_flow * 0.5
                s.daily_return = (
                    (s.net_value - prev.net_value - net_flow) / denom
                    if denom > 0
                    else None
                )
            prev = s
        session.commit()

        return {
            "created": created,
            "updated": updated,
            "total_snapshots": len(all_snaps),
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
        }
    finally:
        session.close()
