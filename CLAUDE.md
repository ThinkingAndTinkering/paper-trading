# Paper Trading Portfolio

## Purpose
Paper trading portfolio web app with multi-portfolio support, cash management, long/short positions, leverage/margin (Reg T), real-time pricing via Yahoo Finance with FX conversion, performance tracking, and portfolio analytics.

## Tech Stack
- **Backend**: Python FastAPI + SQLAlchemy + SQLite + yfinance + pandas/numpy
- **Frontend**: React 19 + Vite 6 + Tailwind CSS v4 + Recharts

## Directory Structure
```
paper-trading/
├── backend/
│   ├── main.py              # FastAPI app, CORS, router includes
│   ├── models.py            # SQLAlchemy ORM (5 tables), init_db, get_session
│   ├── requirements.txt
│   ├── paper_trading.db     # SQLite database (auto-created)
│   ├── routes/
│   │   ├── portfolio.py     # Multi-portfolio CRUD, cash, rename, reset, delete
│   │   ├── trading.py       # Trade execution (buy/sell/short/cover), quotes, ticker search
│   │   ├── positions.py     # Live-enriched positions with P&L per portfolio
│   │   ├── snapshots.py     # Daily snapshot generation, equity history per portfolio
│   │   └── analytics.py     # Sectors, concentration, risk metrics, transactions per portfolio
│   └── services/
│       ├── pricing.py       # yfinance wrapper with 60s TTL cache + FX conversion to USD
│       ├── margin.py        # Reg T margin (only shows when actually borrowing)
│       └── snapshot.py      # Daily NAV snapshot with modified Dietz TWR
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Multi-portfolio selector (drag-to-reorder), nav, setup screen
│   │   ├── api.js           # All fetch() wrappers
│   │   ├── utils.js         # Formatting helpers, colors
│   │   └── pages/
│   │       ├── Dashboard.jsx     # Portfolio summary + sortable positions table + inline Quick Trade
│   │       ├── Transactions.jsx  # Transaction history with filters + CSV export
│   │       ├── Performance.jsx   # Equity curve, daily returns, drawdown
│   │       └── Analytics.jsx     # Sector pie, concentration bars, risk metrics
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
└── CLAUDE.md
```

## Running
- **Backend**: `cd backend && python3 -m uvicorn main:app --port 8002 --reload`
- **Frontend**: `cd frontend && npm run dev` (port 5177, proxies /api to :8002)

## Database Schema
- **portfolios**: id, name, cash_balance, initial_deposit, timestamps
- **positions**: ticker, side (long/short), shares, avg_price, cost_basis — UNIQUE(portfolio_id, ticker, side)
- **transactions**: trade log with realized_pnl
- **cash_transactions**: deposit/withdraw log
- **daily_snapshots**: date, cash, long/short/net value, daily_return — UNIQUE(portfolio_id, date)

## Key Architecture Decisions
- **Multi-portfolio**: Create unlimited portfolios, each fully independent. Order saved to localStorage (drag-to-reorder). Active portfolio ID persisted in localStorage.
- **Portfolio management**: Rename, reset (clear all data + reset cash), delete — all with confirmation modals.
- **FX conversion**: Non-USD tickers (e.g. Korean, Canadian) auto-convert to USD using yfinance forex rates. FX rate cached 5min. Trades execute at USD price. Quote display shows local currency + conversion rate.
- **Margin model**: Reg T — 50% initial, 25% long maintenance, 30% short maintenance. Margin used only shown when actually borrowing (long positions exceed cash or have shorts). No buying power display.
- **Auto-snapshots**: Snapshots save automatically on page load and after every trade (no manual button). Powers Performance tab.
- **Inline trading**: Quick Trade form is on the Portfolio tab alongside positions (no separate Trade page). Click a position row to pre-fill the trade form with that ticker.
- **Ticker search**: Debounced search-as-you-type using yfinance Search API. Shows dropdown with ticker, company name, exchange.
- **Price refresh**: "Refresh Prices" button clears the 60s quote cache and re-fetches all prices.
- **Daily P&L**: Shows $ and % change vs previous snapshot on the portfolio summary.
- **Exposure percentages**: All exposure stats show % of NAV underneath the dollar amounts.
- **NAV display**: Full dollar amount (no rounding to $M/$B), large bold text.
- **Sortable positions**: Click any column header to sort. Default sort by market value descending.
- **CSV export**: Transaction history exportable to CSV from the Transactions tab.
- **State-based page navigation** (no react-router): Portfolio, Transactions, Performance, Analytics.
- **Risk metrics**: Sharpe, Sortino, max drawdown, beta vs SPY, annualized volatility.

## Pages (4 tabs)
1. **Portfolio** — NAV (full dollars), Day P&L, exposure stats with %, refresh button, deposit/withdraw, sortable positions table (click row to trade), inline Quick Trade form with ticker search
2. **Transactions** — Full trade + cash history, filter tabs (All/Trades/Cash), CSV export button
3. **Performance** — Equity curve (NAV vs deposits), daily returns bar chart, drawdown chart, summary stats
4. **Analytics** — Sector exposure pie chart, top 10 concentration bars, risk metrics (Sharpe, Sortino, vol, drawdown, beta)

## API Routes (all prefixed /api)
- `GET /portfolios` — List all portfolios with live stats
- `POST /portfolio` — Create new portfolio
- `GET /portfolio/:id` — Get portfolio with margin stats
- `POST /portfolio/:id/rename` — Rename portfolio
- `POST /portfolio/:id/reset` — Reset portfolio (clear all, reset cash)
- `DELETE /portfolio/:id` — Delete portfolio
- `POST /portfolio/:id/deposit` — Deposit cash
- `POST /portfolio/:id/withdraw` — Withdraw cash
- `POST /trade` — Execute trade (body includes portfolio_id)
- `GET /quote/:ticker` — Live quote with FX conversion
- `GET /search?q=` — Ticker/company search
- `POST /refresh` — Clear price cache
- `GET /positions/:id` — Positions with live P&L
- `GET /transactions/:id` — Trade + cash history
- `POST /snapshots/:id/generate` — Generate/update today's snapshot
- `GET /snapshots/:id` — Snapshot history
- `GET /performance/:id` — Computed return/drawdown stats
- `GET /analytics/:id/sectors` — Sector exposure
- `GET /analytics/:id/concentration` — Top position weights
- `GET /analytics/:id/risk` — Sharpe, Sortino, vol, drawdown, beta

## Current Status
Fully functional with all features implemented. Multi-portfolio with rename/reset/delete/reorder, inline trading with ticker search, FX conversion, auto-snapshots, daily P&L, sortable positions, CSV export, performance charts, and risk analytics.
