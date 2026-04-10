import time
from dataclasses import dataclass, field
from typing import Optional
import yfinance as yf


@dataclass
class QuoteInfo:
    ticker: str
    price: float  # always in USD
    change: float = 0
    change_pct: float = 0
    name: str = ""
    timestamp: float = 0
    currency: str = "USD"
    fx_rate: float = 1.0  # local_currency -> USD
    local_price: float = 0  # price in original currency


# In-memory caches
_quote_cache: dict[str, tuple[QuoteInfo, float]] = {}
_info_cache: dict[str, tuple[dict, float]] = {}
_fx_cache: dict[str, tuple[float, float]] = {}

QUOTE_TTL = 60  # seconds
INFO_TTL = 3600  # 1 hour
FX_TTL = 300  # 5 minutes


def _get_fx_rate(currency: str) -> float:
    """Get exchange rate from currency to USD. Returns multiplier."""
    if not currency or currency.upper() == "USD":
        return 1.0

    currency = currency.upper()
    now = time.time()

    cached = _fx_cache.get(currency)
    if cached and (now - cached[1]) < FX_TTL:
        return cached[0]

    try:
        # yfinance forex ticker format: XXXUSD=X
        fx_ticker = f"{currency}USD=X"
        t = yf.Ticker(fx_ticker)
        fast = t.fast_info
        rate = fast.get("lastPrice") or fast.get("last_price", 0)
        if rate and rate > 0:
            _fx_cache[currency] = (rate, now)
            return rate
    except Exception:
        pass

    # Fallback: try inverse
    try:
        fx_ticker = f"USD{currency}=X"
        t = yf.Ticker(fx_ticker)
        fast = t.fast_info
        rate = fast.get("lastPrice") or fast.get("last_price", 0)
        if rate and rate > 0:
            inverse = 1.0 / rate
            _fx_cache[currency] = (inverse, now)
            return inverse
    except Exception:
        pass

    _fx_cache[currency] = (1.0, now)
    return 1.0


def get_quote(ticker: str) -> Optional[QuoteInfo]:
    """Get a single live quote with 60s caching. Price converted to USD."""
    ticker = ticker.upper().strip()
    now = time.time()

    cached = _quote_cache.get(ticker)
    if cached and (now - cached[1]) < QUOTE_TTL:
        return cached[0]

    try:
        t = yf.Ticker(ticker)
        fast = t.fast_info
        local_price = fast.get("lastPrice") or fast.get("last_price", 0)
        prev_close = fast.get("previousClose") or fast.get("previous_close", local_price)
        change_pct = ((local_price - prev_close) / prev_close * 100) if prev_close else 0

        info = _get_cached_info(ticker)
        name = info.get("shortName") or info.get("longName") or ticker
        currency = info.get("currency") or "USD"

        # Convert to USD
        fx_rate = _get_fx_rate(currency)
        usd_price = local_price * fx_rate
        usd_change = (local_price - prev_close) * fx_rate

        quote = QuoteInfo(
            ticker=ticker,
            price=round(usd_price, 2),
            change=round(usd_change, 2),
            change_pct=round(change_pct, 2),
            name=name,
            timestamp=now,
            currency=currency,
            fx_rate=fx_rate,
            local_price=round(local_price, 2),
        )
        _quote_cache[ticker] = (quote, now)
        return quote
    except Exception as e:
        print(f"Error fetching quote for {ticker}: {e}")
        return None


def clear_quote_cache():
    """Clear all cached quotes to force fresh fetch."""
    _quote_cache.clear()
    _fx_cache.clear()


def get_quotes(tickers: list[str]) -> dict[str, QuoteInfo]:
    """Batch fetch quotes."""
    results = {}
    for t in tickers:
        q = get_quote(t)
        if q:
            results[t.upper()] = q
    return results


def _get_cached_info(ticker: str) -> dict:
    """Get ticker info with 1hr cache."""
    now = time.time()
    cached = _info_cache.get(ticker)
    if cached and (now - cached[1]) < INFO_TTL:
        return cached[0]

    try:
        info = yf.Ticker(ticker).info or {}
        _info_cache[ticker] = (info, now)
        return info
    except Exception:
        return {}


def get_info(ticker: str) -> dict:
    """Public wrapper for ticker info."""
    return _get_cached_info(ticker.upper().strip())


def get_sector(ticker: str) -> str:
    """Get sector for a ticker."""
    info = get_info(ticker)
    return info.get("sector") or "Unknown"


def get_history(ticker: str, period: str = "1y") -> "pd.DataFrame":
    """Get price history for analytics."""
    import pandas as pd
    try:
        t = yf.Ticker(ticker.upper().strip())
        hist = t.history(period=period)
        return hist
    except Exception:
        return pd.DataFrame()
