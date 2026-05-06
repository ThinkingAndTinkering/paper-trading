"""Per-ticker attribution.

Walks consecutive snapshot pairs and isolates each ticker's daily P&L
by netting market-value change against trade flows. Sums to the portfolio
return over the period.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from models import DailySnapshot, Portfolio, get_session


def _period_start(end_d: date, period: str) -> Optional[date]:
    """Returns the cutoff date (inclusive) for the period, or None for 'all'."""
    p = (period or "all").lower()
    if p == "all":
        return None
    if p == "mtd":
        return end_d.replace(day=1)
    if p == "1w":
        return end_d - timedelta(days=7)
    if p == "1m":
        return end_d - timedelta(days=30)
    if p == "3m":
        return end_d - timedelta(days=90)
    if p == "ytd":
        return end_d.replace(month=1, day=1)
    return None


def _index_positions(snap):
    """Return {ticker: {long_mv, short_mv, long_sh, short_sh, long_px, short_px}}."""
    by_ticker = defaultdict(lambda: {
        "long": 0.0, "short": 0.0,
        "long_sh": 0.0, "short_sh": 0.0,
        "long_px": None, "short_px": None,
    })
    if not snap or not snap.positions_json:
        return by_ticker
    try:
        pos = json.loads(snap.positions_json)
    except Exception:
        return by_ticker
    for p in pos:
        side = p.get("side")
        mv = float(p.get("market_value") or 0)
        sh = float(p.get("shares") or 0)
        px = float(p.get("price") or 0)
        if side == "long":
            by_ticker[p["ticker"]]["long"] += mv
            by_ticker[p["ticker"]]["long_sh"] += sh
            by_ticker[p["ticker"]]["long_px"] = px
        elif side == "short":
            by_ticker[p["ticker"]]["short"] += mv
            by_ticker[p["ticker"]]["short_sh"] += sh
            by_ticker[p["ticker"]]["short_px"] = px
    return by_ticker


def compute_attribution(portfolio_id: int, period: str = "all") -> dict:
    session = get_session()
    try:
        p = session.query(Portfolio).get(portfolio_id)
        if not p:
            return {"error": "Portfolio not found"}

        snaps = (
            session.query(DailySnapshot)
            .filter_by(portfolio_id=portfolio_id)
            .order_by(DailySnapshot.date.asc())
            .all()
        )
        if len(snaps) < 2:
            return {
                "items": [],
                "total_dollar": 0,
                "total_return_pct": 0,
                "start_nav": 0,
                "period": period,
            }

        end_snap = snaps[-1]
        end_d = end_snap.date
        cutoff = _period_start(end_d, period)

        # Find the snapshot that anchors the period. Use the last snapshot
        # whose date is <= cutoff. If cutoff is None or before first snap,
        # use the first snapshot.
        if cutoff is None:
            start_idx = 0
        else:
            start_idx = 0
            for i, s in enumerate(snaps):
                if s.date <= cutoff:
                    start_idx = i
            # If cutoff is after first snap, advance to the snap at or
            # closest before cutoff (start_idx is correct).
        start_snap = snaps[start_idx]
        start_d = start_snap.date

        period_snaps = snaps[start_idx:]
        if len(period_snaps) < 2:
            return {
                "items": [],
                "total_dollar": 0,
                "total_return_pct": 0,
                "start_nav": start_snap.net_value,
                "period": period,
            }

        # Walk consecutive snapshot pairs; infer trade flows from share-diffs
        # (rather than from the Transaction log) to sidestep the local-vs-UTC
        # date mismatch between Transaction.created_at and DailySnapshot.date.
        # Implied trade price = the current snapshot's close for that ticker.
        per_ticker = defaultdict(lambda: {
            "long_pnl": 0.0,
            "short_pnl": 0.0,
            "weight_sum": 0.0,
            "weight_n": 0,
            "held_exposure_sum": 0.0,
            "held_pairs": 0,
        })

        for i in range(1, len(period_snaps)):
            prev = period_snaps[i - 1]
            curr = period_snaps[i]
            prev_idx = _index_positions(prev)
            curr_idx = _index_positions(curr)

            tickers = set(prev_idx.keys()) | set(curr_idx.keys())

            for tk in tickers:
                p = prev_idx[tk]
                c = curr_idx[tk]
                prev_long = p["long"]
                curr_long = c["long"]
                prev_short = p["short"]
                curr_short = c["short"]

                # Implied trade price = today's close (fall back to prev close
                # for fully-closed positions where we have no curr price).
                long_px = c["long_px"] if c["long_px"] else p["long_px"] or 0
                short_px = c["short_px"] if c["short_px"] else p["short_px"] or 0

                d_long_sh = c["long_sh"] - p["long_sh"]
                d_short_sh = c["short_sh"] - p["short_sh"]

                # Net out flows at curr-close: a same-day open contributes 0
                # to P&L, a same-day close realizes the gap between prev mark
                # and curr close.
                long_pnl = (curr_long - prev_long) - d_long_sh * long_px
                short_pnl = -(curr_short - prev_short) + d_short_sh * short_px

                t = per_ticker[tk]
                t["long_pnl"] += long_pnl
                t["short_pnl"] += short_pnl

                # Weight = absolute exposure / NAV, only counting days the
                # position was held. This avoids zero-weight days dragging
                # the average down.
                expo = curr_long + curr_short  # absolute exposure today
                if expo > 0 and curr.net_value > 0:
                    t["weight_sum"] += expo / curr.net_value
                    t["weight_n"] += 1
                    t["held_exposure_sum"] += expo
                    t["held_pairs"] += 1

        start_nav = start_snap.net_value or 1
        total_dollar_pnl = 0.0
        items = []
        for tk, t in per_ticker.items():
            dollar = t["long_pnl"] + t["short_pnl"]
            total_dollar_pnl += dollar
            avg_weight = (t["weight_sum"] / t["weight_n"] * 100) if t["weight_n"] else 0
            contribution_pct = (dollar / start_nav * 100) if start_nav else 0

            # Ticker return = $ P&L / avg exposure on days the position was
            # held. Counting only held-days gives an interpretable per-position
            # return; blending in zero-weight days inflates % for short-lived
            # positions.
            avg_held = (t["held_exposure_sum"] / t["held_pairs"]) if t["held_pairs"] else 0
            ticker_return_pct = (dollar / avg_held * 100) if avg_held > 0 else 0

            # Determine net side for display (whichever direction has more pnl)
            side = "long" if abs(t["long_pnl"]) >= abs(t["short_pnl"]) else "short"
            if t["long_pnl"] != 0 and t["short_pnl"] != 0 and (
                (t["long_pnl"] > 0) != (t["short_pnl"] > 0)
            ):
                side = "mixed"

            items.append({
                "ticker": tk,
                "side": side,
                "dollar_pnl": round(dollar, 2),
                "contribution_pct": round(contribution_pct, 4),
                "avg_weight_pct": round(avg_weight, 2),
                "return_pct": round(ticker_return_pct, 2),
            })

        items.sort(key=lambda x: x["dollar_pnl"], reverse=True)
        end_nav = end_snap.net_value
        total_return_pct = ((end_nav - start_nav) / start_nav * 100) if start_nav else 0

        return {
            "items": items,
            "total_dollar": round(total_dollar_pnl, 2),
            "total_return_pct": round(total_return_pct, 4),
            "start_nav": round(start_nav, 2),
            "end_nav": round(end_nav, 2),
            "start_date": start_d.isoformat(),
            "end_date": end_d.isoformat(),
            "period": period,
        }
    finally:
        session.close()
