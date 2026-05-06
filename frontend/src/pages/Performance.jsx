import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, ReferenceLine, AreaChart, Area, Cell,
  ComposedChart,
} from "recharts";
import {
  getSnapshots, getPerformance, backfillSnapshots, getBenchmark, searchTicker,
} from "../api";
import { formatCurrency, formatPct, pnlColor } from "../utils";

// ───────── tick math ─────────

function niceTicks(min, max, count = 5) {
  if (!isFinite(min) || !isFinite(max) || max <= min) return [min || 0, max || 1];
  const range = max - min;
  const rawStep = range / (count - 1);
  const exp = Math.floor(Math.log10(rawStep));
  const f = rawStep / Math.pow(10, exp);
  let nice;
  if (f < 1.5) nice = 1;
  else if (f < 3) nice = 2;
  else if (f < 7) nice = 5;
  else nice = 10;
  const step = nice * Math.pow(10, exp);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 1e-6; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

function dataExtent(data, keys, paddingPct = 0.04) {
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
  return [min - pad, max + pad];
}

// ───────── formatters ─────────

function fmtMoney(v) {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e3)}K`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function fmtPctTick(v) {
  return `${v.toFixed(v >= 10 || v <= -10 ? 0 : 1)}%`;
}

function fmtDateShort(iso) {
  const [y, m, d] = iso.split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateLong(iso) {
  const [y, m, d] = iso.split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// ───────── x-axis tick subset ─────────

function pickXTicks(data, target = 6) {
  if (!data.length) return [];
  if (data.length <= target) return data.map((d) => d.date);
  const stride = Math.max(1, Math.round((data.length - 1) / (target - 1)));
  const ticks = [];
  for (let i = 0; i < data.length; i += stride) ticks.push(data[i].date);
  if (ticks[ticks.length - 1] !== data[data.length - 1].date) {
    ticks.push(data[data.length - 1].date);
  }
  return ticks;
}

// ───────── tooltip ─────────

function ChartTooltip({ active, payload, label, valueFormatter, valueLabel }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="rounded-md px-3 py-2 text-xs shadow-lg"
      style={{
        background: "var(--bg-el)",
        border: "1px solid var(--bdr-mid)",
        color: "var(--t)",
      }}
    >
      <div style={{ color: "var(--t3)" }} className="text-[10px] uppercase tracking-wide mb-1">
        {fmtDateLong(label)}
      </div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 font-mono">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: p.stroke || p.fill || p.color }}
          />
          <span style={{ color: "var(--t2)" }}>{valueLabel?.(p) || p.name}:</span>
          <span style={{ color: "var(--t)" }} className="font-medium">
            {valueFormatter(p.value, p)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ───────── shared chart styling ─────────

const AXIS_TICK = { fill: "var(--t3)", fontSize: 11, fontFamily: "DM Mono, monospace" };
const AXIS_LINE = { stroke: "var(--bdr)" };
const GRID_STROKE = "var(--bdr)";

// ───────── component ─────────

export default function Performance({ portfolioId }) {
  const [snapshots, setSnapshots] = useState([]);
  const [perf, setPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("dollar"); // "dollar" | "percent"

  // Benchmark overlay state
  const [benchmarks, setBenchmarks] = useState([]); // [{ticker, name, points: {date->cum_return_pct}}]
  const [benchInput, setBenchInput] = useState("");
  const [benchSearch, setBenchSearch] = useState([]);
  const [benchLoading, setBenchLoading] = useState(false);
  const [benchError, setBenchError] = useState("");

  const BENCH_COLORS = ["var(--grn)", "#a78bfa"]; // up to 2

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    backfillSnapshots(portfolioId)
      .catch(() => {})
      .then(() =>
        Promise.all([getSnapshots(portfolioId), getPerformance(portfolioId)])
      )
      .then(([snapsData, perfData]) => {
        if (cancelled) return;
        setSnapshots(snapsData.snapshots || []);
        setPerf(perfData);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  const chartData = useMemo(() => {
    if (!snapshots.length) return [];
    const firstNav = snapshots[0].nav || 0;
    return snapshots.map((s) => {
      const cumReturnPct = ((s.nav - s.total_deposits) / s.total_deposits) * 100;
      const row = {
        date: s.date,
        nav: s.nav,
        deposits: s.total_deposits,
        daily_return: s.daily_return,
        cumReturnPct: Math.round(cumReturnPct * 100) / 100,
        pnlDollar: Math.round(s.nav - s.total_deposits),
      };
      // Overlay each benchmark — the % series is computed on the backend
      // (anchor=0% on its first available trading day). For the $ overlay we
      // scale the benchmark to match the portfolio's starting NAV.
      benchmarks.forEach((b, i) => {
        const pct = b.points[s.date];
        if (pct == null) return;
        row[`bench_pct_${i}`] = pct;
        row[`bench_dollar_${i}`] = firstNav * (1 + pct / 100);
      });
      return row;
    });
  }, [snapshots, benchmarks]);

  const drawdownData = useMemo(() => {
    if (!perf?.drawdowns) return [];
    return snapshots.map((s, i) => ({
      date: s.date,
      drawdown: perf.drawdowns[i] || 0,
    }));
  }, [snapshots, perf]);

  const xTicks = useMemo(() => pickXTicks(chartData, 7), [chartData]);
  const xTicksDaily = useMemo(
    () => pickXTicks(chartData.filter((d) => d.daily_return != null), 7),
    [chartData]
  );
  const xTicksDD = useMemo(() => pickXTicks(drawdownData, 7), [drawdownData]);

  const isDollar = mode === "dollar";

  // Y-axis: nice ticks based on the equity series + visible benchmark series
  const equityTicks = useMemo(() => {
    if (!chartData.length) return [];
    const benchKeys = benchmarks.map((_, i) =>
      isDollar ? `bench_dollar_${i}` : `bench_pct_${i}`
    );
    if (isDollar) {
      const [lo, hi] = dataExtent(chartData, ["nav", ...benchKeys], 0.04);
      return niceTicks(lo, hi, 5);
    }
    const [lo, hi] = dataExtent(chartData, ["cumReturnPct", ...benchKeys], 0.1);
    return niceTicks(lo, hi, 5);
  }, [chartData, isDollar, benchmarks]);

  const dailyTicks = useMemo(() => {
    const filtered = chartData.filter((d) => d.daily_return != null);
    if (!filtered.length) return [];
    const [lo, hi] = dataExtent(filtered, ["daily_return"], 0.15);
    // Force 0 to be in the range so the zero line is visible
    return niceTicks(Math.min(lo, 0), Math.max(hi, 0), 5);
  }, [chartData]);

  const ddTicks = useMemo(() => {
    if (!drawdownData.length) return [];
    const [lo, hi] = dataExtent(drawdownData, ["drawdown"], 0.1);
    return niceTicks(Math.min(lo, 0), 0, 5);
  }, [drawdownData]);

  // Debounced ticker search for the "Compare to" input. Must live before any
  // early return so React sees the same hook count on every render.
  useEffect(() => {
    if (!benchInput.trim() || benchInput.length < 2) {
      setBenchSearch([]);
      return;
    }
    const t = setTimeout(() => {
      searchTicker(benchInput.trim())
        .then((d) => setBenchSearch(d.results || d.items || []))
        .catch(() => setBenchSearch([]));
    }, 250);
    return () => clearTimeout(t);
  }, [benchInput]);

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

  // Equity chart header context
  const last = chartData[chartData.length - 1];
  const first = chartData[0];
  const navNow = last?.nav ?? 0;
  const navStart = first?.nav ?? 0;
  const navDelta = navNow - navStart;
  const navDeltaPct = navStart > 0 ? (navDelta / navStart) * 100 : 0;
  const cumPctNow = last?.cumReturnPct ?? 0;

  // Benchmark add/remove
  const addBenchmark = async (ticker) => {
    if (!ticker) return;
    const tk = ticker.toUpperCase().trim();
    if (benchmarks.some((b) => b.ticker === tk)) return;
    if (benchmarks.length >= 2) {
      setBenchError("Max 2 benchmarks");
      return;
    }
    if (!snapshots.length) return;
    setBenchLoading(true);
    setBenchError("");
    try {
      const start = snapshots[0].date;
      const end = snapshots[snapshots.length - 1].date;
      const data = await getBenchmark(tk, start, end);
      if (data.error) {
        setBenchError(data.error);
        return;
      }
      const points = {};
      for (const p of data.series) points[p.date] = p.cum_return_pct;
      setBenchmarks((prev) => [...prev, {
        ticker: data.ticker, name: data.name, points,
      }]);
      setBenchInput("");
      setBenchSearch([]);
    } catch (e) {
      setBenchError(e.message || "failed");
    } finally {
      setBenchLoading(false);
    }
  };
  const removeBenchmark = (ticker) =>
    setBenchmarks((prev) => prev.filter((b) => b.ticker !== ticker));

  // Computed bench return at end-of-series for the small chip stat
  const benchEndPct = benchmarks.map((b) => {
    const dates = Object.keys(b.points).sort();
    return dates.length ? b.points[dates[dates.length - 1]] : null;
  });

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
        <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">
              {isDollar ? "Portfolio Value" : "Cumulative Return"}
            </h2>
            <div className="flex items-baseline gap-3 mt-1">
              <div className="text-2xl font-semibold font-mono tracking-tight text-gray-900">
                {isDollar ? fmtMoney(navNow) : `${cumPctNow.toFixed(2)}%`}
              </div>
              <div
                className={`text-sm font-mono ${pnlColor(isDollar ? navDelta : cumPctNow)}`}
              >
                {isDollar
                  ? `${navDelta >= 0 ? "+" : ""}${fmtMoney(navDelta)} (${navDeltaPct >= 0 ? "+" : ""}${navDeltaPct.toFixed(2)}%)`
                  : `since ${fmtDateShort(first.date)}`}
              </div>
            </div>
          </div>
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

        {/* Compare-to controls */}
        <div className="flex items-center gap-2 mb-4 flex-wrap relative">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Compare to</span>
          {benchmarks.map((b, i) => (
            <span
              key={b.ticker}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-mono"
              style={{
                background: "var(--bg-el)",
                border: `1px solid ${BENCH_COLORS[i]}`,
                color: "var(--t)",
              }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: BENCH_COLORS[i] }}
              />
              {b.ticker}
              {benchEndPct[i] != null && (
                <span className={pnlColor(benchEndPct[i])}>
                  {benchEndPct[i] >= 0 ? "+" : ""}{benchEndPct[i].toFixed(2)}%
                </span>
              )}
              <button
                onClick={() => removeBenchmark(b.ticker)}
                className="ml-1 text-gray-500 hover:text-gray-300"
              >
                ×
              </button>
            </span>
          ))}
          {benchmarks.length < 2 && (
            <div className="relative">
              <input
                type="text"
                value={benchInput}
                onChange={(e) => setBenchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addBenchmark(benchInput);
                  if (e.key === "Escape") { setBenchInput(""); setBenchSearch([]); }
                }}
                placeholder="Add ticker (e.g. SPY, QQQ)"
                disabled={benchLoading}
                className="px-2 py-1 text-xs font-mono rounded-md border w-40"
                style={{
                  background: "var(--bg-el)",
                  borderColor: "var(--bdr)",
                  color: "var(--t)",
                }}
              />
              {benchSearch.length > 0 && (
                <div
                  className="absolute z-10 left-0 mt-1 rounded-md shadow-lg overflow-hidden"
                  style={{
                    background: "var(--bg-el)",
                    border: "1px solid var(--bdr-mid)",
                    minWidth: "240px",
                    maxHeight: "240px",
                    overflowY: "auto",
                  }}
                >
                  {benchSearch.slice(0, 8).map((r) => (
                    <button
                      key={r.symbol || r.ticker}
                      onClick={() => addBenchmark(r.symbol || r.ticker)}
                      className="block w-full text-left px-3 py-2 text-xs hover:bg-gray-700"
                      style={{ color: "var(--t)" }}
                    >
                      <span className="font-mono font-medium">{r.symbol || r.ticker}</span>
                      <span className="text-gray-500 ml-2">{r.name || r.shortname || ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {benchError && (
            <span className="text-xs text-red-500">{benchError}</span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={320}>
          {isDollar ? (
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                ticks={xTicks}
                tickFormatter={fmtDateShort}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                domain={[equityTicks[0], equityTicks[equityTicks.length - 1]]}
                ticks={equityTicks}
                tickFormatter={fmtMoney}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                cursor={{ stroke: "var(--bdr-str)", strokeDasharray: "3 3" }}
                content={
                  <ChartTooltip
                    valueFormatter={(v) => fmtMoney(v)}
                    valueLabel={(p) => (p.dataKey === "deposits" ? "Deposits" : "NAV")}
                  />
                }
              />
              <Area
                type="linear"
                dataKey="nav"
                stroke="var(--blue)"
                strokeWidth={1.75}
                fill="url(#navGrad)"
                dot={false}
                activeDot={{ r: 3, stroke: "var(--bg-card)", strokeWidth: 2 }}
                name="NAV"
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="deposits"
                stroke="var(--t3)"
                strokeWidth={1}
                strokeDasharray="3 4"
                dot={false}
                name="Deposits"
                isAnimationActive={false}
              />
              {benchmarks.map((b, i) => (
                <Line
                  key={b.ticker}
                  type="linear"
                  dataKey={`bench_dollar_${i}`}
                  stroke={BENCH_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  name={b.ticker}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="returnGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                ticks={xTicks}
                tickFormatter={fmtDateShort}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                domain={[equityTicks[0], equityTicks[equityTicks.length - 1]]}
                ticks={equityTicks}
                tickFormatter={fmtPctTick}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                cursor={{ stroke: "var(--bdr-str)", strokeDasharray: "3 3" }}
                content={
                  <ChartTooltip
                    valueFormatter={(v) => `${v.toFixed(2)}%`}
                    valueLabel={() => "Return"}
                  />
                }
              />
              <ReferenceLine y={0} stroke="var(--bdr-mid)" strokeDasharray="3 3" />
              <Area
                type="linear"
                dataKey="cumReturnPct"
                stroke="var(--blue)"
                strokeWidth={1.75}
                fill="url(#returnGrad)"
                dot={false}
                activeDot={{ r: 3, stroke: "var(--bg-card)", strokeWidth: 2 }}
                name="Return"
                isAnimationActive={false}
              />
              {benchmarks.map((b, i) => (
                <Line
                  key={b.ticker}
                  type="linear"
                  dataKey={`bench_pct_${i}`}
                  stroke={BENCH_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  name={b.ticker}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Daily Returns */}
      {chartData.some((d) => d.daily_return != null) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 text-sm mb-4">Daily Returns</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chartData.filter((d) => d.daily_return != null)}
              margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                ticks={xTicksDaily}
                tickFormatter={fmtDateShort}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                domain={[dailyTicks[0], dailyTicks[dailyTicks.length - 1]]}
                ticks={dailyTicks}
                tickFormatter={(v) => `${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                cursor={{ fill: "var(--bg-hover)" }}
                content={
                  <ChartTooltip
                    valueFormatter={(v) => `${v.toFixed(2)}%`}
                    valueLabel={() => "Return"}
                  />
                }
              />
              <ReferenceLine y={0} stroke="var(--bdr-mid)" />
              <Bar dataKey="daily_return" name="Return" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {chartData
                  .filter((d) => d.daily_return != null)
                  .map((d, i) => (
                    <Cell key={i} fill={d.daily_return >= 0 ? "var(--grn)" : "var(--red)"} />
                  ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Drawdown */}
      {drawdownData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 text-sm mb-4">Drawdown</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={drawdownData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--red)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--red)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                ticks={xTicksDD}
                tickFormatter={fmtDateShort}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                domain={[ddTicks[0], 0]}
                ticks={ddTicks}
                tickFormatter={fmtPctTick}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                cursor={{ stroke: "var(--bdr-str)", strokeDasharray: "3 3" }}
                content={
                  <ChartTooltip
                    valueFormatter={(v) => `${v.toFixed(2)}%`}
                    valueLabel={() => "Drawdown"}
                  />
                }
              />
              <ReferenceLine y={0} stroke="var(--bdr-mid)" />
              <Area
                type="linear"
                dataKey="drawdown"
                stroke="var(--red)"
                strokeWidth={1.75}
                fill="url(#ddGrad)"
                dot={false}
                activeDot={{ r: 3, stroke: "var(--bg-card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
