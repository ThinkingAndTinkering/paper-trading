import json
from datetime import date
from models import get_session, Portfolio, Position, DailySnapshot
from services.pricing import get_quotes


def generate_snapshot(portfolio_id: int = None) -> dict:
    """Generate (or update) today's daily snapshot."""
    session = get_session()
    try:
        p = session.query(Portfolio).first() if not portfolio_id else \
            session.query(Portfolio).get(portfolio_id)
        if not p:
            return {"error": "No portfolio found"}

        today = date.today()

        # Get positions and prices
        db_positions = session.query(Position).filter_by(portfolio_id=p.id).all()
        long_value = 0.0
        short_value = 0.0
        positions_detail = []

        if db_positions:
            tickers = list(set(pos.ticker for pos in db_positions))
            quotes = get_quotes(tickers)

            for pos in db_positions:
                q = quotes.get(pos.ticker)
                current_price = q.price if q else pos.avg_price
                mv = pos.shares * current_price

                if pos.side == "long":
                    long_value += mv
                else:
                    short_value += mv

                positions_detail.append({
                    "ticker": pos.ticker,
                    "side": pos.side,
                    "shares": pos.shares,
                    "price": current_price,
                    "market_value": round(mv, 2),
                })

        nav = p.cash_balance + long_value - short_value

        # Get previous snapshot for daily return
        prev = session.query(DailySnapshot).filter(
            DailySnapshot.portfolio_id == p.id,
            DailySnapshot.date < today
        ).order_by(DailySnapshot.date.desc()).first()

        daily_return = None
        if prev and prev.net_value > 0:
            # Net external cash flow = change in total deposits between snapshots
            net_flow = p.initial_deposit - prev.total_deposits

            # Modified Dietz return (weight cash flow at midpoint of period)
            denominator = prev.net_value + net_flow * 0.5
            if denominator > 0:
                daily_return = (nav - prev.net_value - net_flow) / denominator

        # Upsert snapshot
        existing = session.query(DailySnapshot).filter_by(
            portfolio_id=p.id, date=today
        ).first()

        if existing:
            existing.cash = p.cash_balance
            existing.long_value = long_value
            existing.short_value = short_value
            existing.net_value = nav
            existing.total_deposits = p.initial_deposit
            existing.daily_return = daily_return
            existing.positions_json = json.dumps(positions_detail)
            snap = existing
        else:
            snap = DailySnapshot(
                portfolio_id=p.id,
                date=today,
                cash=p.cash_balance,
                long_value=long_value,
                short_value=short_value,
                net_value=nav,
                total_deposits=p.initial_deposit,
                daily_return=daily_return,
                positions_json=json.dumps(positions_detail),
            )
            session.add(snap)

        session.commit()

        return {
            "date": today.isoformat(),
            "nav": round(nav, 2),
            "cash": round(p.cash_balance, 2),
            "long_value": round(long_value, 2),
            "short_value": round(short_value, 2),
            "daily_return": round(daily_return * 100, 4) if daily_return is not None else None,
        }
    finally:
        session.close()
