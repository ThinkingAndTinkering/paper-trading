import { useState, useEffect, useRef } from "react";
import {
  getPositions,
  deposit,
  withdraw,
  generateSnapshot,
  getQuote,
  executeTrade,
  searchTicker,
  refreshPrices,
  getSnapshots,
} from "../api";
import { formatCurrency, formatPct, formatShares, pnlColor } from "../utils";

function formatNavFull(value) {
  if (value == null) return "—";
  return "$" + Math.round(value).toLocaleString("en-US");
}

function PnlStat({ label, pnl }) {
  if (!pnl) return null;
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-xl font-bold ${pnlColor(pnl.dollars)}`}>
        {pnl.dollars >= 0 ? "+" : ""}{formatCurrency(pnl.dollars)}
        <span className="ml-1 text-sm font-medium">
          ({pnl.pct >= 0 ? "+" : ""}{pnl.pct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

function PortfolioSummary({ portfolio, pnlStats, onUpdate, onRefresh, refreshing }) {
  const [cashAmount, setCashAmount] = useState("");
  const [cashLoading, setCashLoading] = useState(false);

  const handleCash = async (action) => {
    const amt = parseFloat(cashAmount);
    if (!amt || amt <= 0) return;
    setCashLoading(true);
    try {
      if (action === "deposit") await deposit(portfolio.id, amt);
      else await withdraw(portfolio.id, amt);
      setCashAmount("");
      onUpdate();
    } catch (e) {
      alert(e.message);
    }
    setCashLoading(false);
  };

  const nav = portfolio.nav || 1;
  const pctOf = (v) => (nav > 0 ? `${((v / nav) * 100).toFixed(1)}%` : "");

  const stats = [
    {
      label: "Cash",
      value: formatCurrency(portfolio.cash),
      sub: pctOf(portfolio.cash),
    },
    {
      label: "Long",
      value: formatCurrency(portfolio.long_value),
      sub: pctOf(portfolio.long_value),
    },
    {
      label: "Short",
      value: formatCurrency(portfolio.short_value),
      sub: pctOf(portfolio.short_value),
    },
    {
      label: "Net Exposure",
      value: formatCurrency(portfolio.net_exposure),
      sub: pctOf(Math.abs(portfolio.net_exposure)),
    },
    {
      label: "Gross Exposure",
      value: formatCurrency(portfolio.gross_exposure),
      sub: pctOf(portfolio.gross_exposure),
    },
    { label: "Leverage", value: `${portfolio.leverage}x` },
    ...(portfolio.margin_used > 0
      ? [
          {
            label: "Margin Used",
            value: formatCurrency(portfolio.margin_used),
          },
        ]
      : []),
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      {portfolio.margin_call && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 mb-4 font-medium">
          MARGIN CALL — Portfolio below maintenance requirement
        </div>
      )}

      {/* NAV row */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-baseline gap-6 flex-wrap">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">
              NAV
            </div>
            <div className="text-4xl font-bold text-gray-900 tracking-tight">
              {formatNavFull(portfolio.nav)}
            </div>
          </div>
          <PnlStat label="Day P&L" pnl={pnlStats?.day} />
          <PnlStat label="MTD P&L" pnl={pnlStats?.mtd} />
          <PnlStat label="YTD P&L" pnl={pnlStats?.ytd} />
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshing ? "Refreshing..." : "Refresh Prices"}
        </button>
      </div>

      <div className="border-t border-gray-100 pt-4 mb-4" />

      {/* Stats grid */}
      <div className="flex flex-wrap gap-x-8 gap-y-3 mb-4">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <div className="text-[11px] text-gray-500 uppercase tracking-wide">
              {s.label}
            </div>
            <div className="font-semibold text-sm text-gray-800 whitespace-nowrap">{s.value}</div>
            {s.sub && <div className="text-xs text-gray-400">{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Cash actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
        <input
          type="number"
          placeholder="Amount"
          value={cashAmount}
          onChange={(e) => setCashAmount(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 w-32 text-sm"
        />
        <button
          onClick={() => handleCash("deposit")}
          disabled={cashLoading}
          className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          Deposit
        </button>
        <button
          onClick={() => handleCash("withdraw")}
          disabled={cashLoading}
          className="bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}

function TradeForm({ portfolioId, nav, onTraded, prefillTicker }) {
  const [ticker, setTicker] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [action, setAction] = useState("buy");
  const [shares, setShares] = useState("");
  const [tradeLoading, setTradeLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchTimeout = useRef(null);

  // Handle prefill from position click
  useEffect(() => {
    if (prefillTicker) {
      lookupQuote(prefillTicker);
    }
  }, [prefillTicker]);

  const lookupQuote = async (t) => {
    const symbol = (t || ticker).trim().toUpperCase();
    if (!symbol) return;
    setQuoteLoading(true);
    setQuote(null);
    setError("");
    setResult(null);
    setShowSearch(false);
    setTicker(symbol);
    try {
      const q = await getQuote(symbol);
      setQuote(q);
    } catch (e) {
      setError(e.message);
    }
    setQuoteLoading(false);
  };

  const handleTickerInput = (val) => {
    setTicker(val.toUpperCase());
    setQuote(null);
    setResult(null);
    setError("");

    // Debounced search
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.trim().length >= 2) {
      searchTimeout.current = setTimeout(async () => {
        try {
          const res = await searchTicker(val.trim());
          setSearchResults(res.results || []);
          setShowSearch(true);
        } catch {
          setSearchResults([]);
        }
      }, 300);
    } else {
      setSearchResults([]);
      setShowSearch(false);
    }
  };

  const selectSearchResult = (symbol) => {
    setShowSearch(false);
    setSearchResults([]);
    lookupQuote(symbol);
  };

  const handleTrade = async () => {
    const numShares = parseFloat(shares);
    if (!numShares || numShares <= 0) {
      setError("Enter a valid number of shares");
      return;
    }
    if (!quote) {
      setError("Look up a quote first");
      return;
    }
    setTradeLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await executeTrade({
        portfolio_id: portfolioId,
        ticker: quote.ticker,
        action,
        shares: numShares,
      });
      setResult(res);
      setShares("");
      onTraded();
    } catch (e) {
      setError(e.message);
    }
    setTradeLoading(false);
  };

  const estimatedTotal =
    quote && shares ? parseFloat(shares) * quote.price : 0;
  const projectedWeight =
    estimatedTotal > 0 && nav > 0
      ? ((estimatedTotal / nav) * 100).toFixed(1)
      : null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 mb-4">Quick Trade</h2>
      <div className="space-y-3">
        {/* Ticker + Quote with search */}
        <div className="relative">
          <div className="flex gap-2">
            <input
              type="text"
              value={ticker}
              onChange={(e) => handleTickerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setShowSearch(false);
                  lookupQuote();
                }
              }}
              onFocus={() => searchResults.length > 0 && setShowSearch(true)}
              placeholder="Search ticker or company..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={() => lookupQuote()}
              disabled={quoteLoading}
              className="bg-gray-800 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
            >
              {quoteLoading ? "..." : "Quote"}
            </button>
          </div>

          {/* Search dropdown */}
          {showSearch && searchResults.length > 0 && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => selectSearchResult(r.ticker)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex justify-between items-center text-sm border-b border-gray-50 last:border-0"
                >
                  <div>
                    <span className="font-mono font-medium text-gray-900">
                      {r.ticker}
                    </span>
                    <span className="ml-2 text-gray-500 text-xs">
                      {r.name}
                    </span>
                  </div>
                  {r.exchange && (
                    <span className="text-xs text-gray-400">{r.exchange}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {quote && (
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="font-bold text-gray-900">{quote.ticker}</span>
                <span className="ml-1.5 text-xs text-gray-500">
                  {quote.name}
                </span>
              </div>
              <div className="text-right">
                <span className="font-bold font-mono">
                  ${quote.price.toFixed(2)}
                </span>
                <span
                  className={`ml-2 text-xs font-mono ${pnlColor(quote.change)}`}
                >
                  {quote.change >= 0 ? "+" : ""}
                  {quote.change.toFixed(2)} ({formatPct(quote.change_pct)})
                </span>
              </div>
            </div>
            {quote.currency && (
              <div className="text-xs text-gray-400 mt-0.5">
                Local: {quote.currency} {quote.local_price?.toLocaleString()} (1 {quote.currency} = ${quote.fx_rate?.toFixed(4)} USD)
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-4 gap-1.5">
          {["buy", "sell", "short", "cover"].map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                action === a
                  ? a === "buy" || a === "cover"
                    ? "bg-emerald-600 text-white"
                    : "bg-red-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Shares */}
        <input
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder="Shares"
          min="0"
          step="1"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />

        {/* Estimated total + projected weight */}
        {estimatedTotal > 0 && (
          <div className="bg-gray-50 rounded-lg px-3 py-2 flex justify-between items-center text-sm">
            <div>
              <div className="text-gray-600">Estimated Total</div>
              {projectedWeight && (
                <div className="text-xs text-gray-400">
                  ~{projectedWeight}% of NAV
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="font-bold font-mono">
                {formatCurrency(estimatedTotal)}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2 text-xs">
            <span className="font-medium">
              {result.action.toUpperCase()} {result.shares} {result.ticker} @{" "}
              ${result.price.toFixed(2)}
            </span>
            {result.realized_pnl !== 0 && (
              <span className={` ml-2 ${pnlColor(result.realized_pnl)}`}>
                P&L: {formatCurrency(result.realized_pnl)}
              </span>
            )}
          </div>
        )}

        <button
          onClick={handleTrade}
          disabled={tradeLoading || !quote}
          className={`w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${
            action === "buy" || action === "cover"
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {tradeLoading
            ? "Executing..."
            : `${action.toUpperCase()} ${shares || 0} ${quote?.ticker || "..."}`}
        </button>
      </div>
    </div>
  );
}

const COLUMNS = [
  { key: "ticker", label: "Ticker", align: "left", getValue: (p) => p.ticker },
  { key: "side", label: "Side", align: "left", getValue: (p) => p.side },
  { key: "shares", label: "Shares", align: "right", getValue: (p) => p.shares },
  { key: "avg_price", label: "Avg Cost", align: "right", getValue: (p) => p.avg_price },
  { key: "current_price", label: "Price", align: "right", getValue: (p) => p.current_price },
  { key: "market_value", label: "Mkt Value", align: "right", getValue: (p) => p.market_value },
  { key: "unrealized_pnl", label: "P&L", align: "right", getValue: (p) => p.unrealized_pnl },
  { key: "unrealized_pnl_pct", label: "P&L %", align: "right", getValue: (p) => p.unrealized_pnl_pct },
  { key: "weight", label: "Weight", align: "right", getValue: (p) => p.weight },
];

function PositionsTable({ positions, onSelectTicker }) {
  const [sortKey, setSortKey] = useState("market_value");
  const [sortAsc, setSortAsc] = useState(false);

  if (!positions?.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
        No open positions. Use the trade form to open one.
      </div>
    );
  }

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "ticker" || key === "side"); // alpha defaults asc
    }
  };

  const sorted = [...positions].sort((a, b) => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return 0;
    const av = col.getValue(a);
    const bv = col.getValue(b);
    let cmp = 0;
    if (typeof av === "string") cmp = av.localeCompare(bv);
    else cmp = (av ?? 0) - (bv ?? 0);
    return sortAsc ? cmp : -cmp;
  });

  const arrow = (key) =>
    sortKey === key ? (sortAsc ? " \u25B2" : " \u25BC") : "";

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Open Positions</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase" style={{ fontSize: "10px" }}>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`${col.align === "right" ? "text-right" : "text-left"} px-2.5 py-2.5 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap`}
                >
                  {col.label}
                  <span className="text-blue-500">{arrow(col.key)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((pos) => (
              <tr
                key={`${pos.ticker}-${pos.side}`}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => onSelectTicker?.(pos.ticker)}
              >
                <td className="px-2.5 py-2.5">
                  <div className="font-medium text-blue-700 hover:text-blue-900">{pos.ticker}</div>
                  <div className="text-gray-500 truncate max-w-28" style={{ fontSize: "10px" }}>
                    {pos.name}
                  </div>
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded font-medium ${
                      pos.side === "long"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700"
                    }`}
                    style={{ fontSize: "10px" }}
                  >
                    {pos.side.toUpperCase()}
                  </span>
                </td>
                <td className="text-right px-2.5 py-2.5 font-mono">
                  {formatShares(pos.shares)}
                </td>
                <td className="text-right px-2.5 py-2.5 font-mono">
                  ${pos.avg_price.toFixed(2)}
                </td>
                <td className="text-right px-2.5 py-2.5 font-mono">
                  <div>${pos.current_price.toFixed(2)}</div>
                  <div className={pnlColor(pos.change)} style={{ fontSize: "10px" }}>
                    {formatPct(pos.change_pct)}
                  </div>
                </td>
                <td className="text-right px-2.5 py-2.5 font-mono">
                  {formatCurrency(pos.market_value)}
                </td>
                <td
                  className={`text-right px-2.5 py-2.5 font-mono font-medium ${pnlColor(pos.unrealized_pnl)}`}
                >
                  {formatCurrency(pos.unrealized_pnl)}
                </td>
                <td
                  className={`text-right px-2.5 py-2.5 font-mono ${pnlColor(pos.unrealized_pnl_pct)}`}
                >
                  {formatPct(pos.unrealized_pnl_pct)}
                </td>
                <td className="text-right px-2.5 py-2.5 font-mono">
                  {pos.weight.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Dashboard({ portfolio, onUpdate }) {
  const [positions, setPositions] = useState([]);
  const [nav, setNav] = useState(0);
  const [pnlStats, setPnlStats] = useState({ day: null, mtd: null, ytd: null });
  const [refreshing, setRefreshing] = useState(false);
  const [prefillTicker, setPrefillTicker] = useState(null);

  // Local date string (YYYY-MM-DD) matching Python's date.today()
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const loadDashboard = async () => {
    try {
      const [posData, snapData] = await Promise.all([
        getPositions(portfolio.id),
        getSnapshots(portfolio.id),
      ]);

      const pos = posData.positions || [];
      const liveNav = posData.nav || 0;
      setPositions(pos);
      setNav(liveNav);

      // Day P&L: sum intraday price changes across all positions
      // (accurate regardless of snapshot history)
      let dayDollars = 0;
      for (const p of pos) {
        const priceChange = p.change || 0;
        dayDollars += p.side === "long" ? p.shares * priceChange : -p.shares * priceChange;
      }
      const prevNavDay = liveNav - dayDollars;
      const dayPct = prevNavDay > 0 ? (dayDollars / prevNavDay) * 100 : 0;

      // MTD / YTD: use snapshots with local date (not UTC)
      const snaps = snapData.snapshots || [];
      const today = localToday();
      const month = today.substring(0, 7);
      const year = today.substring(0, 4);

      const calcPnl = (refNav) => {
        if (!refNav || refNav <= 0) return null;
        return {
          dollars: liveNav - refNav,
          pct: ((liveNav - refNav) / refNav) * 100,
        };
      };

      const beforeThisMonth = snaps.filter((s) => s.date.substring(0, 7) < month);
      const prevMonth = beforeThisMonth.length > 0 ? beforeThisMonth[beforeThisMonth.length - 1] : null;

      const beforeThisYear = snaps.filter((s) => s.date.substring(0, 4) < year);
      const prevYear = beforeThisYear.length > 0 ? beforeThisYear[beforeThisYear.length - 1] : null;

      setPnlStats({
        day: { dollars: dayDollars, pct: dayPct },
        mtd: calcPnl(prevMonth?.nav),
        ytd: calcPnl(prevYear?.nav),
      });
    } catch {
      setPositions([]);
      setPnlStats({ day: null, mtd: null, ytd: null });
    }
  };

  useEffect(() => {
    loadDashboard();
    generateSnapshot(portfolio.id).catch(() => {});
  }, [portfolio]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPrices();
      onUpdate();
      await generateSnapshot(portfolio.id).catch(() => {});
      await loadDashboard();
    } catch {}
    setRefreshing(false);
  };

  const handleTraded = () => {
    onUpdate();
    generateSnapshot(portfolio.id)
      .then(() => loadDashboard())
      .catch(() => {});
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">{portfolio.name}</h1>
      </div>
      <PortfolioSummary
        portfolio={portfolio}
        pnlStats={pnlStats}
        onUpdate={onUpdate}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <PositionsTable positions={positions} onSelectTicker={(t) => setPrefillTicker(t + "_" + Date.now())} />
        <TradeForm
          portfolioId={portfolio.id}
          nav={nav || portfolio.nav}
          onTraded={handleTraded}
          prefillTicker={prefillTicker?.split("_")[0]}
        />
      </div>
    </div>
  );
}
