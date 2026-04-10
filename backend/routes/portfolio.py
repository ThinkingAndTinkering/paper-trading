from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from models import get_session, Portfolio, CashTransaction, Position
from services.pricing import get_quotes, clear_quote_cache
from services.margin import calculate_margin_stats

router = APIRouter()


class CreatePortfolio(BaseModel):
    name: str = "Main"
    initial_deposit: float = 100000


class CashAction(BaseModel):
    amount: float


def _get_portfolio(session, portfolio_id: int):
    p = session.query(Portfolio).get(portfolio_id)
    if not p:
        raise HTTPException(404, f"Portfolio {portfolio_id} not found")
    return p


def _enrich_portfolio(session, p):
    """Enrich a portfolio with live margin stats."""
    db_positions = session.query(Position).filter_by(portfolio_id=p.id).all()
    enriched = []
    if db_positions:
        tickers = list(set(pos.ticker for pos in db_positions))
        quotes = get_quotes(tickers)
        for pos in db_positions:
            q = quotes.get(pos.ticker)
            current_price = q.price if q else pos.avg_price
            market_value = pos.shares * current_price
            enriched.append({"side": pos.side, "market_value": market_value})

    stats = calculate_margin_stats(p.cash_balance, enriched)
    return {
        "id": p.id,
        "name": p.name,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        **stats,
    }


@router.get("/portfolios")
def list_portfolios():
    """List all portfolios with summary stats."""
    session = get_session()
    try:
        portfolios = session.query(Portfolio).order_by(Portfolio.created_at.asc()).all()
        results = []
        for p in portfolios:
            results.append(_enrich_portfolio(session, p))
        return {"portfolios": results}
    finally:
        session.close()


@router.get("/portfolio/{portfolio_id}")
def get_portfolio(portfolio_id: int):
    session = get_session()
    try:
        p = _get_portfolio(session, portfolio_id)
        return {**_enrich_portfolio(session, p), "exists": True}
    finally:
        session.close()


@router.post("/portfolio")
def create_portfolio(data: CreatePortfolio):
    session = get_session()
    try:
        p = Portfolio(
            name=data.name,
            cash_balance=data.initial_deposit,
            initial_deposit=data.initial_deposit,
        )
        session.add(p)
        session.flush()

        ct = CashTransaction(
            portfolio_id=p.id,
            action="deposit",
            amount=data.initial_deposit,
            balance_after=data.initial_deposit,
        )
        session.add(ct)
        session.commit()

        return {"id": p.id, "name": p.name, "cash_balance": p.cash_balance}
    finally:
        session.close()


@router.post("/portfolio/{portfolio_id}/deposit")
def deposit(portfolio_id: int, data: CashAction):
    if data.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    session = get_session()
    try:
        p = _get_portfolio(session, portfolio_id)

        p.cash_balance += data.amount
        p.initial_deposit += data.amount
        p.updated_at = datetime.utcnow()

        ct = CashTransaction(
            portfolio_id=p.id,
            action="deposit",
            amount=data.amount,
            balance_after=p.cash_balance,
        )
        session.add(ct)
        session.commit()

        return {"cash_balance": p.cash_balance}
    finally:
        session.close()


@router.post("/portfolio/{portfolio_id}/withdraw")
def withdraw(portfolio_id: int, data: CashAction):
    if data.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    session = get_session()
    try:
        p = _get_portfolio(session, portfolio_id)

        if data.amount > p.cash_balance:
            raise HTTPException(400, f"Insufficient cash. Available: ${p.cash_balance:,.2f}")

        p.cash_balance -= data.amount
        p.initial_deposit -= data.amount
        p.updated_at = datetime.utcnow()

        ct = CashTransaction(
            portfolio_id=p.id,
            action="withdraw",
            amount=data.amount,
            balance_after=p.cash_balance,
        )
        session.add(ct)
        session.commit()

        return {"cash_balance": p.cash_balance}
    finally:
        session.close()


@router.post("/refresh")
def refresh_prices():
    """Clear price cache to force fresh quotes."""
    clear_quote_cache()
    return {"status": "refreshed"}


class RenamePortfolio(BaseModel):
    name: str


@router.post("/portfolio/{portfolio_id}/rename")
def rename_portfolio(portfolio_id: int, data: RenamePortfolio):
    if not data.name.strip():
        raise HTTPException(400, "Name cannot be empty")
    session = get_session()
    try:
        p = _get_portfolio(session, portfolio_id)
        p.name = data.name.strip()
        p.updated_at = datetime.utcnow()
        session.commit()
        return {"id": p.id, "name": p.name}
    finally:
        session.close()


@router.post("/portfolio/{portfolio_id}/reset")
def reset_portfolio(portfolio_id: int, data: CreatePortfolio):
    """Reset portfolio: clear all positions/transactions, set new cash balance."""
    session = get_session()
    try:
        p = _get_portfolio(session, portfolio_id)

        from models import Transaction, DailySnapshot
        session.query(DailySnapshot).filter_by(portfolio_id=p.id).delete()
        session.query(Transaction).filter_by(portfolio_id=p.id).delete()
        session.query(CashTransaction).filter_by(portfolio_id=p.id).delete()
        session.query(Position).filter_by(portfolio_id=p.id).delete()

        p.cash_balance = data.initial_deposit
        p.initial_deposit = data.initial_deposit
        p.name = data.name or p.name
        p.updated_at = datetime.utcnow()

        ct = CashTransaction(
            portfolio_id=p.id,
            action="deposit",
            amount=data.initial_deposit,
            balance_after=data.initial_deposit,
        )
        session.add(ct)
        session.commit()

        return {"status": "reset", "cash_balance": p.cash_balance}
    finally:
        session.close()


@router.delete("/portfolio/{portfolio_id}")
def delete_portfolio(portfolio_id: int):
    """Delete a portfolio and all related data."""
    session = get_session()
    try:
        p = _get_portfolio(session, portfolio_id)

        from models import Transaction, DailySnapshot
        session.query(DailySnapshot).filter_by(portfolio_id=p.id).delete()
        session.query(Transaction).filter_by(portfolio_id=p.id).delete()
        session.query(CashTransaction).filter_by(portfolio_id=p.id).delete()
        session.query(Position).filter_by(portfolio_id=p.id).delete()
        session.delete(p)
        session.commit()

        return {"status": "deleted"}
    finally:
        session.close()
