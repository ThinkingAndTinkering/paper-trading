import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, ReferenceLine, AreaChart, Area,
} from "recharts";
import { getSnapshots, getPerformance } from "../api";
import { formatCurrency, formatPct, pnlColor } from "../utils";

function yDomain(data, keys, paddingPct = 0.05) {
  let min = Infinity, max = -Infinity;
  for (const d of data) {
    for (const k of keys) {
      const v = d[k];
      if (v != null && isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!isFinite(min)) return [0, 1];
  const range = max - min || Math.abs(max) * 0.1 || 1;
  const pad = range * paddingPct;
  return [Math.floor((min - pad) * 100) / 100, Math.ceil((max + pad) * 100) / 100];
}

export default function Performance({ portfolioId }) {
  const [snapshots, setSnapshots] = useState([]);
  const [perf, setPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("dollar"); // "dollar" | "percent"

  useEffect(() => {
    setLoading(true);
    Promise.all([getSnapshots(portfolioId), getPerformance(portfolioId)])
      .then(([snapsData, perfData]) => {
        setSnapshots(snapsData.snapshots || []);
        setPerf(perfData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [portfolioId]);

  const chartData = useMemo(() => {
    if (!snapshots.length) return [];
    const baseDeposits = snapshots[0].total_deposits || 1;
    return snapshots.map((s) => {
      const cumReturnPct = ((s.nav - s.total_deposits) / s.total_deposits) * 100;
      return {
        date: s.date,
        nav: s.nav,
        deposits: s.total_deposits,
        daily_return: s.daily_return,
        cumReturnPct: Math.round(cumReturnPct * 100) / 100,
        pnlDollar: Math.round(s.nav - s.total_deposits),
      };
    });
  }, [snapshots]);

  const drawdownData = useMemo(() => {
    if (!perf?.drawdowns) return [];
    return snapshots.map((s, i) => ({
      date: s.date,
      drawdown: perf.drawdowns[i] || 0,
    }));
  }, [snapshots, perf]);

  if (loading) {
    return <div className="text-center text-gray-500 py-12">Loading...</div>;
  }

  if (!snapshots.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
        No snapshots yet. Snapshots are saved automatically after each trade.
      </div>
    );
  }

  const isDollar = mode === "dollar";

  // Compute y-axis domains
  const equityDomain = isDollar
    ? yDomain(chartData, ["nav", "deposits"], 0.03)
    : yDomain(chartData, ["cumReturnPct"], 0.1);

  const returnDomain = yDomain(
    chartData.filter((d) => d.daily_return != null),
    ["daily_return"],
    0.15
  );

  const ddDomain = yDomain(drawdownData, ["drawdown"], 0.1);
  // Drawdown should always have 0 at top
  ddDomain[1] = Math.max(ddDomain[1], 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Performance</h1>

      {/* Summary Stats */}
      {perf && !perf.message && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[
            { label: "Total Return", value: formatPct(perf.total_return_pct), color: pnlColor(perf.total_return_pct) },
            { label: "Annualized", value: formatPct(perf.annualized_return_pct), color: pnlColor(perf.annualized_return_pct) },
            { label: "Best Day", value: formatPct(perf.best_day_pct), color: "text-emerald-600" },
            { label: "Worst Day", value: formatPct(perf.worst_day_pct), color: "text-red-600" },
            { label: "Max Drawdown", value: formatPct(perf.max_drawdown_pct), color: "text-red-600" },
            { label: "Snapshots", value: perf.num_snapshots },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-4"
            >
              <div className="text-xs text-gray-500 uppercase tracking-wide">
                {s.label}
              </div>
              <div className={`text-lg font-bold ${s.color || "text-gray-900"}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Equity Curve */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">
            {isDollar ? "Portfolio Value" : "Cumulative Return"}
          </h2>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setMode("dollar")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                isDollar ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              $
            </button>
            <button
              onClick={() => setMode("percent")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                !isDollar ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              %
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={350}>
          {isDollar ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis
                domain={equityDomain}
                tickFormatter={(v) => `$${Math.round(v / 1000)}K`}
                tick={{ fontSize: 11 }}
                width={70}
              />
              <Tooltip
                formatter={(v, name) => [
                  formatCurrency(v),
                  name === "nav" ? "NAV" : "Deposits",
                ]}
                labelFormatter={(l) => `Date: ${l}`}
              />
              <Line
                type="monotone"
                dataKey="nav"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="nav"
              />
              <Line
                type="monotone"
                dataKey="deposits"
                stroke="#9ca3af"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                name="deposits"
              />
            </LineChart>
          ) : (
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="returnGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis
                domain={equityDomain}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11 }}
                width={60}
              />
              <Tooltip
                formatter={(v) => [`${v.toFixed(2)}%`, "Return"]}
                labelFormatter={(l) => `Date: ${l}`}
              />
              <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="cumReturnPct"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#returnGrad)"
                dot={false}
                name="Return"
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Daily Returns */}
      {chartData.some((d) => d.daily_return != null) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Daily Returns</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData.filter((d) => d.daily_return != null)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis
                domain={returnDomain}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11 }}
                width={60}
              />
              <Tooltip
                formatter={(v) => [`${v.toFixed(2)}%`, "Return"]}
                labelFormatter={(l) => `Date: ${l}`}
              />
              <ReferenceLine y={0} stroke="#9ca3af" />
              <Bar
                dataKey="daily_return"
                name="Return"
                fill="#3b82f6"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Drawdown */}
      {drawdownData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Drawdown</h2>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={drawdownData}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis
                domain={ddDomain}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11 }}
                width={60}
              />
              <Tooltip
                formatter={(v) => [`${v.toFixed(2)}%`, "Drawdown"]}
                labelFormatter={(l) => `Date: ${l}`}
              />
              <ReferenceLine y={0} stroke="#9ca3af" />
              <Area
                type="monotone"
                dataKey="drawdown"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#ddGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
