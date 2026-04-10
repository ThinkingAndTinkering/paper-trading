import json
from datetime import datetime, date
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from models import get_session, Portfolio, Position, Transaction, CashTransaction, DailySnapshot

router = APIRouter()


def serialize_date(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


@router.get("/export")
def export_all():
    session = get_session()
    try:
        data = {"portfolios": []}
        for p in session.query(Portfolio).all():
            portfolio_data = {
                "name": p.name,
                "cash_balance": p.cash_balance,
                "initial_deposit": p.initial_deposit,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "positions": [],
                "transactions": [],
                "cash_transactions": [],
                "snapshots": [],
            }
            for pos in session.query(Position).filter_by(portfolio_id=p.id).all():
                portfolio_data["positions"].append({
                    "ticker": pos.ticker,
                    "side": pos.side,
                    "shares": pos.shares,
                    "cost_basis": pos.cost_basis,
                    "avg_price": pos.avg_price,
                    "opened_at": pos.opened_at.isoformat() if pos.opened_at else None,
                })
            for t in session.query(Transaction).filter_by(portfolio_id=p.id).order_by(Transaction.created_at).all():
                portfolio_data["transactions"].append({
                    "ticker": t.ticker,
                    "action": t.action,
                    "shares": t.shares,
                    "price": t.price,
                    "total_value": t.total_value,
                    "realized_pnl": t.realized_pnl,
                    "notes": t.notes,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                })
            for ct in session.query(CashTransaction).filter_by(portfolio_id=p.id).order_by(CashTransaction.created_at).all():
                portfolio_data["cash_transactions"].append({
                    "action": ct.action,
                    "amount": ct.amount,
                    "balance_after": ct.balance_after,
                    "created_at": ct.created_at.isoformat() if ct.created_at else None,
                })
            for s in session.query(DailySnapshot).filter_by(portfolio_id=p.id).order_by(DailySnapshot.date).all():
                portfolio_data["snapshots"].append({
                    "date": s.date.isoformat(),
                    "cash": s.cash,
                    "long_value": s.long_value,
                    "short_value": s.short_value,
                    "net_value": s.net_value,
                    "total_deposits": s.total_deposits,
                    "daily_return": s.daily_return,
                    "positions_json": s.positions_json,
                })
            data["portfolios"].append(portfolio_data)
        return data
    finally:
        session.close()


@router.post("/import")
async def import_all(file: UploadFile = File(...)):
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return JSONResponse(status_code=400, content={"detail": "Invalid JSON file"})

    if "portfolios" not in data:
        return JSONResponse(status_code=400, content={"detail": "Missing 'portfolios' key in JSON"})

    session = get_session()
    imported = 0
    try:
        for pd in data["portfolios"]:
            # Replace existing portfolio with same name
            existing = session.query(Portfolio).filter_by(name=pd["name"]).first()
            if existing:
                session.query(DailySnapshot).filter_by(portfolio_id=existing.id).delete()
                session.query(CashTransaction).filter_by(portfolio_id=existing.id).delete()
                session.query(Transaction).filter_by(portfolio_id=existing.id).delete()
                session.query(Position).filter_by(portfolio_id=existing.id).delete()
                session.delete(existing)
                session.flush()

            p = Portfolio(
                name=pd["name"],
                cash_balance=pd["cash_balance"],
                initial_deposit=pd["initial_deposit"],
                created_at=datetime.fromisoformat(pd["created_at"]) if pd.get("created_at") else datetime.utcnow(),
            )
            session.add(p)
            session.flush()  # Get the ID

            for pos in pd.get("positions", []):
                session.add(Position(
                    portfolio_id=p.id,
                    ticker=pos["ticker"],
                    side=pos["side"],
                    shares=pos["shares"],
                    cost_basis=pos["cost_basis"],
                    avg_price=pos["avg_price"],
                    opened_at=datetime.fromisoformat(pos["opened_at"]) if pos.get("opened_at") else datetime.utcnow(),
                ))

            for t in pd.get("transactions", []):
                session.add(Transaction(
                    portfolio_id=p.id,
                    ticker=t["ticker"],
                    action=t["action"],
                    shares=t["shares"],
                    price=t["price"],
                    total_value=t["total_value"],
                    realized_pnl=t.get("realized_pnl", 0),
                    notes=t.get("notes"),
                    created_at=datetime.fromisoformat(t["created_at"]) if t.get("created_at") else datetime.utcnow(),
                ))

            for ct in pd.get("cash_transactions", []):
                session.add(CashTransaction(
                    portfolio_id=p.id,
                    action=ct["action"],
                    amount=ct["amount"],
                    balance_after=ct["balance_after"],
                    created_at=datetime.fromisoformat(ct["created_at"]) if ct.get("created_at") else datetime.utcnow(),
                ))

            for s in pd.get("snapshots", []):
                session.add(DailySnapshot(
                    portfolio_id=p.id,
                    date=date.fromisoformat(s["date"]),
                    cash=s["cash"],
                    long_value=s["long_value"],
                    short_value=s["short_value"],
                    net_value=s["net_value"],
                    total_deposits=s["total_deposits"],
                    daily_return=s.get("daily_return"),
                    positions_json=s.get("positions_json"),
                ))

            imported += 1

        session.commit()
        return {"imported": imported, "total": len(data["portfolios"])}
    except Exception as e:
        session.rollback()
        return JSONResponse(status_code=500, content={"detail": str(e)})
    finally:
        session.close()
