import os
from datetime import datetime, date
from sqlalchemy import (
    create_engine, Column, Integer, Float, String, Text,
    DateTime, Date, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "paper_trading.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, default="Main")
    cash_balance = Column(Float, nullable=False, default=0)
    initial_deposit = Column(Float, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    positions = relationship("Position", back_populates="portfolio")
    transactions = relationship("Transaction", back_populates="portfolio")
    cash_transactions = relationship("CashTransaction", back_populates="portfolio")
    snapshots = relationship("DailySnapshot", back_populates="portfolio")


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    ticker = Column(String(20), nullable=False)
    side = Column(String(5), nullable=False)  # 'long' or 'short'
    shares = Column(Float, nullable=False)
    cost_basis = Column(Float, nullable=False)  # total cost
    avg_price = Column(Float, nullable=False)
    opened_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    portfolio = relationship("Portfolio", back_populates="positions")

    __table_args__ = (
        UniqueConstraint("portfolio_id", "ticker", "side", name="uq_portfolio_ticker_side"),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    ticker = Column(String(20), nullable=False)
    action = Column(String(10), nullable=False)  # buy, sell, short, cover
    shares = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    total_value = Column(Float, nullable=False)
    realized_pnl = Column(Float, default=0)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    portfolio = relationship("Portfolio", back_populates="transactions")


class CashTransaction(Base):
    __tablename__ = "cash_transactions"

    id = Column(Integer, primary_key=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    action = Column(String(10), nullable=False)  # deposit, withdraw
    amount = Column(Float, nullable=False)
    balance_after = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    portfolio = relationship("Portfolio", back_populates="cash_transactions")


class DailySnapshot(Base):
    __tablename__ = "daily_snapshots"

    id = Column(Integer, primary_key=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    date = Column(Date, nullable=False)
    cash = Column(Float, nullable=False)
    long_value = Column(Float, nullable=False)
    short_value = Column(Float, nullable=False)
    net_value = Column(Float, nullable=False)  # NAV
    total_deposits = Column(Float, nullable=False)
    daily_return = Column(Float)
    positions_json = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    portfolio = relationship("Portfolio", back_populates="snapshots")

    __table_args__ = (
        UniqueConstraint("portfolio_id", "date", name="uq_portfolio_date"),
    )


def init_db():
    Base.metadata.create_all(engine)


def get_session():
    return SessionLocal()
