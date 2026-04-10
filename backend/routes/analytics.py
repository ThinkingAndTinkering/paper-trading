import numpy as np
from fastapi import APIRouter
from models import get_session, Portfolio, Position, DailySnapshot
from services.pricing import get_quotes, get_sector, get_history

router = APIRouter()


@router.get("/analytics/{portfolio_id}/sectors")
def sector_exposure(portfolio_id: int):
    session = get_session()
    try:
        p = session.query(Portfolio).get(portfolio_id)
        if not p:
            return {"sectors": []}

        db_positions = session.query(Position).filter_by(portfolio_id=p.id).all()
        if not db_positions:
            return {"sectors": []}

        tickers = list(set(pos.ticker for pos in db_positions))
        quotes = get_quotes(tickers)

        sector_map: dict[str, float] = {}
        for pos in db_positions:
            q = quotes.get(pos.ticker)
            cp = q.price if q else pos.avg_price
            mv = pos.shares * cp
            sector = get_sector(pos.ticker)
            if pos.side == "short":
                mv = -mv
            sector_map[sector] = sector_map.get(sector, 0) + mv

        total = sum(abs(v) for v in sector_map.values())
        sectors = [
            {
                "sector": k,
                "value": round(v, 2),
                "weight": round(abs(v) / total * 100, 2) if total else 0,
            }
            for k, v in sorted(sector_map.items(), key=lambda x: abs(x[1]), reverse=True)
        ]

        return {"sectors": sectors}
    finally:
        session.close()


@router.get("/analytics/{portfolio_id}/concentration")
def concentration(portfolio_id: int):
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
        items = []
        for pos in db_positions:
            q = quotes.get(pos.ticker)
            cp = q.price if q else pos.avg_price
            mv = pos.shares * cp
            if pos.side == "long":
                long_val += mv
            else:
                short_val += mv
            items.append({
                "ticker": pos.ticker,
                "side": pos.side,
                "market_value": round(mv, 2),
                "name": q.name if q else pos.ticker,
            })

        nav = p.cash_balance + long_val - short_val
        for item in items:
            item["weight"] = round(item["market_value"] / nav * 100, 2) if nav else 0

        items.sort(key=lambda x: abs(x["market_value"]), reverse=True)
        return {"positions": items[:10], "nav": round(nav, 2)}
    finally:
        session.close()


@router.get("/analytics/{portfolio_id}/risk")
def risk_metrics(portfolio_id: int):
    session = get_session()
    try:
        snaps = session.query(DailySnapshot).filter_by(
            portfolio_id=portfolio_id
        ).order_by(DailySnapshot.date.asc()).all()

        if len(snaps) < 2:
            return {"message": "Need at least 2 snapshots for risk metrics"}

        returns = [s.daily_return for s in snaps if s.daily_return is not None]
        if not returns:
            return {"message": "No return data available"}

        returns_arr = np.array(returns)

        vol = np.std(returns_arr) * np.sqrt(252) * 100

        rf_daily = 0.05 / 252
        excess = returns_arr - rf_daily
        sharpe = (np.mean(excess) / np.std(returns_arr) * np.sqrt(252)) if np.std(returns_arr) > 0 else 0

        downside = returns_arr[returns_arr < 0]
        downside_std = np.std(downside) if len(downside) > 0 else 0.001
        sortino = (np.mean(excess) / downside_std * np.sqrt(252)) if downside_std > 0 else 0

        navs = np.array([s.net_value for s in snaps])
        peaks = np.maximum.accumulate(navs)
        drawdowns = (navs - peaks) / peaks
        max_dd = np.min(drawdowns) * 100

        beta = None
        try:
            spy_hist = get_history("SPY", "1y")
            if len(spy_hist) >= 20:
                spy_returns = spy_hist["Close"].pct_change().dropna().values[-len(returns_arr):]
                if len(spy_returns) == len(returns_arr):
                    cov = np.cov(returns_arr, spy_returns)
                    beta = round(cov[0, 1] / cov[1, 1], 2) if cov[1, 1] > 0 else None
        except Exception:
            pass

        return {
            "sharpe_ratio": round(sharpe, 2),
            "sortino_ratio": round(sortino, 2),
            "annualized_volatility_pct": round(vol, 2),
            "max_drawdown_pct": round(max_dd, 2),
            "current_drawdown_pct": round(drawdowns[-1] * 100, 2),
            "beta_vs_spy": beta,
            "num_observations": len(returns),
        }
    finally:
        session.close()


@router.get("/transactions/{portfolio_id}")
def get_transactions(portfolio_id: int):
    from models import Transaction, CashTransaction
    session = get_session()
    try:
        trades = session.query(Transaction).filter_by(
            portfolio_id=portfolio_id
        ).order_by(Transaction.created_at.desc()).all()

        cash_txs = session.query(CashTransaction).filter_by(
            portfolio_id=portfolio_id
        ).order_by(CashTransaction.created_at.desc()).all()

        result = []
        for t in trades:
            result.append({
                "type": "trade",
                "date": t.created_at.isoformat() if t.created_at else None,
                "ticker": t.ticker,
                "action": t.action,
                "shares": t.shares,
                "price": round(t.price, 2),
                "total_value": round(t.total_value, 2),
                "realized_pnl": round(t.realized_pnl, 2),
                "notes": t.notes,
            })

        for ct in cash_txs:
            result.append({
                "type": "cash",
                "date": ct.created_at.isoformat() if ct.created_at else None,
                "action": ct.action,
                "amount": round(ct.amount, 2),
                "balance_after": round(ct.balance_after, 2),
            })

        result.sort(key=lambda x: x["date"] or "", reverse=True)
        return {"transactions": result}
    finally:
        session.close()
