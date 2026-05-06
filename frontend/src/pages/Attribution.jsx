import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { getAttribution } from "../api";
import { pnlColor } from "../utils";

const PERIODS = [
  { id: "all", label: "All" },
  { id: "ytd", label: "YTD" },
  { id: "3m", label: "3M" },
  { id: "1m", label: "1M" },
  { id: "mtd", label: "MTD" },
  { id: "1w", label: "1W" },
];

const SORT_KEYS = [
  { id: "dollar_pnl", label: "$ P&L", numeric: true, default: "desc" },
  { id: "contribution_pct", label: "Contribution %", numeric: true, default: "desc" },
  { id: "return_pct", label: "Return %", numeric: true, default: "desc" },
  { id: "avg_weight_pct", label: "Avg Weight %", numeric: true, default: "desc" },
  { id: "ticker", label: "Ticker", numeric: false, default: "asc" },
];

function fmtMoney(v) {
  if (v == null || !isFinite(v)) return "—";
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e3)}K`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function fmtPct(v, digits = 2) {
  if (v == null || !isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export default function Attribution({ portfolioId }) {
  const [period, setPeriod] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("dollar_pnl");
  const [sortDir, setSortDir] = useState("desc");
  const [view, setView] = useState("dollar"); // "dollar" | "percent"

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAttribution(portfolioId, period)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId, period]);

  const items = data?.items || [];
  const sortedItems = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [items, sortBy, sortDir]);

  const chartData = useMemo(() => {
    const key = view === "dollar" ? "dollar_pnl" : "contribution_pct";
    const arr = [...items].sort((a, b) => b[key] - a[key]);
    return arr.map((it) => ({ ...it, _val: it[key] }));
  }, [items, view]);

  const chartHeight = Math.max(180, chartData.length * 26 + 40);

  const headerClick = (key) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      const def = SORT_KEYS.find((k) => k.id === key);
      setSortDir(def?.default || "desc");
    }
  };

  if (loading && !data) {
    return <div className="text-center text-gray-500 py-12">Loading...</div>;
  }
  if (!data || !items.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
        No attribution data for this period yet.
      </div>
    );
  }

  const top = chartData[0];
  const bot = chartData[chartData.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Attribution</h1>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                period === p.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Period Return</div>
          <div className={`text-lg font-bold ${pnlColor(data.total_return_pct)}`}>
            {fmtPct(data.total_return_pct)}
          </div>
          <div className="text-xs text-gray-500 font-mono">
            {fmtMoney(data.total_dollar)}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Top Contributor</div>
          <div className="text-lg font-bold text-emerald-600">
            {top?.ticker || "—"}
          </div>
          <div className="text-xs text-gray-500 font-mono">
            {fmtMoney(top?.dollar_pnl)} · {fmtPct(top?.contribution_pct)}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Top Detractor</div>
          <div className="text-lg font-bold text-red-600">
            {bot && bot.dollar_pnl < 0 ? bot.ticker : "—"}
          </div>
          <div className="text-xs text-gray-500 font-mono">
            {bot && bot.dollar_pnl < 0
              ? `${fmtMoney(bot.dollar_pnl)} · ${fmtPct(bot.contribution_pct)}`
              : "no detractors"}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Window</div>
          <div className="text-sm font-mono text-gray-900">
            {data.start_date} → {data.end_date}
          </div>
          <div className="text-xs text-gray-500 font-mono">
            NAV {fmtMoney(data.start_nav)} → {fmtMoney(data.end_nav)}
          </div>
        </div>
      </div>

      {/* Decomposition chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-900 text-sm">
            {view === "dollar" ? "$ P&L by Position" : "% Contribution to Return"}
          </h2>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setView("dollar")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                view === "dollar" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              $
            </button>
            <button
              onClick={() => setView("percent")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                view === "percent" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              %
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 60, left: 8, bottom: 8 }}
          >
            <CartesianGrid stroke="var(--bdr)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: "var(--t3)", fontSize: 11, fontFamily: "DM Mono, monospace" }}
              axisLine={{ stroke: "var(--bdr)" }}
              tickLine={false}
              tickFormatter={(v) => (view === "dollar" ? fmtMoney(v).replace(/^[+-]/, "") : `${v.toFixed(1)}%`)}
            />
            <YAxis
              dataKey="ticker"
              type="category"
              width={80}
              tick={{ fill: "var(--t2)", fontSize: 11, fontFamily: "DM Mono, monospace" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--bg-hover)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div
                    className="rounded-md px-3 py-2 text-xs shadow-lg"
                    style={{
                      background: "var(--bg-el)",
                      border: "1px solid var(--bdr-mid)",
                      color: "var(--t)",
                    }}
                  >
                    <div className="font-medium mb-1">{d.ticker} <span style={{color:"var(--t3)"}}>· {d.side}</span></div>
                    <div className="font-mono">$ P&L: {fmtMoney(d.dollar_pnl)}</div>
                    <div className="font-mono">Contribution: {fmtPct(d.contribution_pct)}</div>
                    <div className="font-mono">Return: {fmtPct(d.return_pct)}</div>
                    <div className="font-mono">Avg weight: {d.avg_weight_pct.toFixed(2)}%</div>
                  </div>
                );
              }}
            />
            <ReferenceLine x={0} stroke="var(--bdr-str)" />
            <Bar dataKey="_val" radius={[0, 2, 2, 0]} isAnimationActive={false}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d._val >= 0 ? "var(--grn)" : "var(--red)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detail table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 text-sm mb-4">By Position</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {SORT_KEYS.map((k) => (
                  <th
                    key={k.id}
                    onClick={() => headerClick(k.id)}
                    className={`py-2 px-3 cursor-pointer select-none text-xs uppercase tracking-wide text-gray-500 ${
                      k.numeric ? "text-right" : "text-left"
                    }`}
                  >
                    {k.label}
                    {sortBy === k.id ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className="py-2 px-3 text-xs uppercase tracking-wide text-gray-500 text-left">
                  Side
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((row) => (
                <tr key={row.ticker} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 font-mono font-medium text-gray-900 text-right">
                    {fmtMoney(row.dollar_pnl)}
                  </td>
                  <td className={`py-2 px-3 font-mono text-right ${pnlColor(row.contribution_pct)}`}>
                    {fmtPct(row.contribution_pct)}
                  </td>
                  <td className={`py-2 px-3 font-mono text-right ${pnlColor(row.return_pct)}`}>
                    {fmtPct(row.return_pct)}
                  </td>
                  <td className="py-2 px-3 font-mono text-right text-gray-700">
                    {row.avg_weight_pct.toFixed(2)}%
                  </td>
                  <td className="py-2 px-3 font-mono font-medium text-gray-900 text-left">
                    {row.ticker}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500 text-left">
                    {row.side}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
