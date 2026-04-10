from fastapi import APIRouter
from models import get_session, Portfolio, DailySnapshot
from services.snapshot import generate_snapshot

router = APIRouter()


@router.post("/snapshots/{portfolio_id}/generate")
def create_snapshot(portfolio_id: int):
    result = generate_snapshot(portfolio_id=portfolio_id)
    return result


@router.get("/snapshots/{portfolio_id}")
def get_snapshots(portfolio_id: int):
    session = get_session()
    try:
        snaps = session.query(DailySnapshot).filter_by(
            portfolio_id=portfolio_id
        ).order_by(DailySnapshot.date.asc()).all()

        return {
            "snapshots": [
                {
                    "date": s.date.isoformat(),
                    "nav": round(s.net_value, 2),
                    "cash": round(s.cash, 2),
                    "long_value": round(s.long_value, 2),
                    "short_value": round(s.short_value, 2),
                    "total_deposits": round(s.total_deposits, 2),
                    "daily_return": round(s.daily_return * 100, 4) if s.daily_return is not None else None,
                }
                for s in snaps
            ]
        }
    finally:
        session.close()


@router.get("/performance/{portfolio_id}")
def get_performance(portfolio_id: int):
    session = get_session()
    try:
        snaps = session.query(DailySnapshot).filter_by(
            portfolio_id=portfolio_id
        ).order_by(DailySnapshot.date.asc()).all()

        if not snaps:
            return {"message": "No snapshots yet. Generate one first."}

        returns = [s.daily_return for s in snaps if s.daily_return is not None]
        navs = [s.net_value for s in snaps]

        first_deposit = snaps[0].total_deposits
        latest_nav = snaps[-1].net_value
        latest_deposits = snaps[-1].total_deposits
        total_return_pct = ((latest_nav - latest_deposits) / latest_deposits * 100) if latest_deposits else 0

        peak = navs[0]
        drawdowns = []
        max_dd = 0
        for nav in navs:
            if nav > peak:
                peak = nav
            dd = (nav - peak) / peak if peak else 0
            drawdowns.append(round(dd * 100, 4))
            if dd < max_dd:
                max_dd = dd

        best_day = max(returns) * 100 if returns else 0
        worst_day = min(returns) * 100 if returns else 0

        num_days = len(snaps)
        if num_days > 1 and latest_deposits > 0:
            total_return_decimal = (latest_nav - latest_deposits) / latest_deposits
            annualized = ((1 + total_return_decimal) ** (252 / num_days) - 1) * 100
        else:
            annualized = 0

        return {
            "total_return_pct": round(total_return_pct, 2),
            "annualized_return_pct": round(annualized, 2),
            "best_day_pct": round(best_day, 2),
            "worst_day_pct": round(worst_day, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "current_drawdown_pct": round(drawdowns[-1], 2) if drawdowns else 0,
            "num_snapshots": len(snaps),
            "drawdowns": drawdowns,
        }
    finally:
        session.close()
