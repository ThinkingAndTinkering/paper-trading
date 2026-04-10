from fastapi import APIRouter, HTTPException, Query
from models import get_session, Portfolio, Position
from services.pricing import get_quotes, get_sector

router = APIRouter()


@router.get("/positions/{portfolio_id}")
def get_positions(portfolio_id: int):
    session = get_session()
    try:
        p = session.query(Portfolio).get(portfolio_id)
        if not p:
            return {"positions": []}

        db_positions = session.query(Position).filter_by(portfolio_id=p.id).all()
        if not db_positions:
            return {"positions": []}

        tickers = list(set(pos.ticker for pos in db_positions))
        quotes = get_quotes(tickers)

        long_val = 0
        short_val = 0
        results = []

        for pos in db_positions:
            q = quotes.get(pos.ticker)
            current_price = q.price if q else pos.avg_price
            market_value = pos.shares * current_price

            if pos.side == "long":
                unrealized_pnl = (current_price - pos.avg_price) * pos.shares
                long_val += market_value
            else:
                unrealized_pnl = (pos.avg_price - current_price) * pos.shares
                short_val += market_value

            pnl_pct = (unrealized_pnl / pos.cost_basis * 100) if pos.cost_basis else 0

            row = {
                "id": pos.id,
                "ticker": pos.ticker,
                "side": pos.side,
                "shares": pos.shares,
                "avg_price": round(pos.avg_price, 2),
                "current_price": round(current_price, 2),
                "cost_basis": round(pos.cost_basis, 2),
                "market_value": round(market_value, 2),
                "unrealized_pnl": round(unrealized_pnl, 2),
                "unrealized_pnl_pct": round(pnl_pct, 2),
                "name": q.name if q else pos.ticker,
                "change": q.change if q else 0,
                "change_pct": q.change_pct if q else 0,
            }
            if q and q.currency != "USD":
                row["currency"] = q.currency
            results.append(row)

        nav = p.cash_balance + long_val - short_val

        for r in results:
            r["weight"] = round(r["market_value"] / nav * 100, 2) if nav else 0

        results.sort(key=lambda x: x["market_value"], reverse=True)
        return {"positions": results, "nav": round(nav, 2)}
    finally:
        session.close()
