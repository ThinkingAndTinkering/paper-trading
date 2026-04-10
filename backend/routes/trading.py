from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from models import get_session, Portfolio, Position, Transaction
from services.pricing import get_quote, get_quotes
from services.margin import calculate_margin_stats, check_trade_margin

router = APIRouter()


class TradeRequest(BaseModel):
    ticker: str
    action: str  # buy, sell, short, cover
    shares: float
    notes: Optional[str] = None


class TradeRequestWithPortfolio(BaseModel):
    portfolio_id: int
    ticker: str
    action: str  # buy, sell, short, cover
    shares: float
    notes: Optional[str] = None


@router.post("/trade")
def execute_trade(data: TradeRequestWithPortfolio):
    ticker = data.ticker.upper().strip()
    action = data.action.lower().strip()
    shares = data.shares

    if action not in ("buy", "sell", "short", "cover"):
        raise HTTPException(400, f"Invalid action: {action}")
    if shares <= 0:
        raise HTTPException(400, "Shares must be positive")

    # Get live price
    quote = get_quote(ticker)
    if not quote or quote.price <= 0:
        raise HTTPException(400, f"Could not get price for {ticker}")

    price = quote.price
    trade_value = shares * price

    session = get_session()
    try:
        p = session.query(Portfolio).get(data.portfolio_id)
        if not p:
            raise HTTPException(404, "Portfolio not found.")

        # Get current positions for margin check
        db_positions = session.query(Position).filter_by(portfolio_id=p.id).all()
        enriched_positions = []
        if db_positions:
            tickers = list(set(pos.ticker for pos in db_positions))
            quotes = get_quotes(tickers)
            for pos in db_positions:
                q = quotes.get(pos.ticker)
                cp = q.price if q else pos.avg_price
                enriched_positions.append({
                    "side": pos.side,
                    "market_value": pos.shares * cp,
                })

        realized_pnl = 0

        if action == "buy":
            # Check margin
            allowed, reason = check_trade_margin(p.cash_balance, enriched_positions, trade_value, "buy")
            if not allowed:
                raise HTTPException(400, reason)

            # Deduct cash
            p.cash_balance -= trade_value

            # Update or create position
            pos = session.query(Position).filter_by(
                portfolio_id=p.id, ticker=ticker, side="long"
            ).first()
            if pos:
                # Average up/down
                new_total_shares = pos.shares + shares
                new_cost_basis = pos.cost_basis + trade_value
                pos.shares = new_total_shares
                pos.cost_basis = new_cost_basis
                pos.avg_price = new_cost_basis / new_total_shares
                pos.updated_at = datetime.utcnow()
            else:
                pos = Position(
                    portfolio_id=p.id,
                    ticker=ticker,
                    side="long",
                    shares=shares,
                    cost_basis=trade_value,
                    avg_price=price,
                )
                session.add(pos)

        elif action == "sell":
            pos = session.query(Position).filter_by(
                portfolio_id=p.id, ticker=ticker, side="long"
            ).first()
            if not pos:
                raise HTTPException(400, f"No long position in {ticker}")
            if shares > pos.shares:
                raise HTTPException(400, f"Cannot sell {shares} shares. Only hold {pos.shares}")

            # Realized P&L
            realized_pnl = (price - pos.avg_price) * shares

            # Credit cash
            p.cash_balance += trade_value

            # Reduce position
            pos.shares -= shares
            pos.cost_basis = pos.shares * pos.avg_price
            pos.updated_at = datetime.utcnow()

            if pos.shares <= 0.0001:  # float tolerance
                session.delete(pos)

        elif action == "short":
            # Check margin
            allowed, reason = check_trade_margin(p.cash_balance, enriched_positions, trade_value, "short")
            if not allowed:
                raise HTTPException(400, reason)

            # Credit cash (short sale proceeds)
            p.cash_balance += trade_value

            # Update or create short position
            pos = session.query(Position).filter_by(
                portfolio_id=p.id, ticker=ticker, side="short"
            ).first()
            if pos:
                new_total_shares = pos.shares + shares
                new_cost_basis = pos.cost_basis + trade_value
                pos.shares = new_total_shares
                pos.cost_basis = new_cost_basis
                pos.avg_price = new_cost_basis / new_total_shares
                pos.updated_at = datetime.utcnow()
            else:
                pos = Position(
                    portfolio_id=p.id,
                    ticker=ticker,
                    side="short",
                    shares=shares,
                    cost_basis=trade_value,
                    avg_price=price,
                )
                session.add(pos)

        elif action == "cover":
            pos = session.query(Position).filter_by(
                portfolio_id=p.id, ticker=ticker, side="short"
            ).first()
            if not pos:
                raise HTTPException(400, f"No short position in {ticker}")
            if shares > pos.shares:
                raise HTTPException(400, f"Cannot cover {shares} shares. Only short {pos.shares}")

            # Realized P&L (short profit = sold high, buy low)
            realized_pnl = (pos.avg_price - price) * shares

            # Deduct cash to cover
            p.cash_balance -= trade_value

            # Reduce position
            pos.shares -= shares
            pos.cost_basis = pos.shares * pos.avg_price
            pos.updated_at = datetime.utcnow()

            if pos.shares <= 0.0001:
                session.delete(pos)

        p.updated_at = datetime.utcnow()

        # Record transaction
        tx = Transaction(
            portfolio_id=p.id,
            ticker=ticker,
            action=action,
            shares=shares,
            price=price,
            total_value=trade_value,
            realized_pnl=realized_pnl,
            notes=data.notes,
        )
        session.add(tx)
        session.commit()

        return {
            "status": "executed",
            "ticker": ticker,
            "action": action,
            "shares": shares,
            "price": price,
            "total_value": round(trade_value, 2),
            "realized_pnl": round(realized_pnl, 2),
            "cash_balance": round(p.cash_balance, 2),
        }
    finally:
        session.close()


@router.get("/quote/{ticker}")
def get_ticker_quote(ticker: str):
    quote = get_quote(ticker.upper().strip())
    if not quote:
        raise HTTPException(404, f"Could not find ticker: {ticker}")
    result = {
        "ticker": quote.ticker,
        "price": quote.price,
        "change": quote.change,
        "change_pct": quote.change_pct,
        "name": quote.name,
    }
    if quote.currency != "USD":
        result["currency"] = quote.currency
        result["local_price"] = quote.local_price
        result["fx_rate"] = round(quote.fx_rate, 6)
    return result


@router.get("/search")
def search_ticker(q: str = ""):
    """Search for tickers by company name or symbol."""
    import yfinance as yf
    query = q.strip()
    if not query or len(query) < 2:
        return {"results": []}

    try:
        # First try as a direct ticker
        results = []
        direct = get_quote(query.upper())
        if direct and direct.price > 0:
            results.append({
                "ticker": direct.ticker,
                "name": direct.name,
                "price": direct.price,
            })

        # Use yfinance search
        search = yf.Search(query)
        for item in (search.quotes or [])[:8]:
            symbol = item.get("symbol", "")
            name = item.get("shortname") or item.get("longname") or ""
            if symbol and symbol != query.upper():
                results.append({
                    "ticker": symbol,
                    "name": name,
                    "exchange": item.get("exchange", ""),
                })

        return {"results": results[:8]}
    except Exception as e:
        # Fallback: just try as a direct ticker
        direct = get_quote(query.upper())
        if direct and direct.price > 0:
            return {"results": [{"ticker": direct.ticker, "name": direct.name, "price": direct.price}]}
        return {"results": []}
