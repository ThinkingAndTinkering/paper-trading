import { useState, useEffect } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { getSectors, getConcentration, getRiskMetrics } from "../api";
import { formatCurrency, SECTOR_COLORS } from "../utils";

function RiskCard({ metrics }) {
  if (metrics?.message) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-gray-500">
        {metrics.message}
      </div>
    );
  }

  const items = [
    { label: "Sharpe Ratio", value: metrics.sharpe_ratio?.toFixed(2) },
    { label: "Sortino Ratio", value: metrics.sortino_ratio?.toFixed(2) },
    {
      label: "Ann. Volatility",
      value: `${metrics.annualized_volatility_pct?.toFixed(1)}%`,
    },
    {
      label: "Max Drawdown",
      value: `${metrics.max_drawdown_pct?.toFixed(1)}%`,
    },
    {
      label: "Current Drawdown",
      value: `${metrics.current_drawdown_pct?.toFixed(1)}%`,
    },
    {
      label: "Beta vs SPY",
      value: metrics.beta_vs_spy?.toFixed(2) ?? "N/A",
    },
    { label: "Observations", value: metrics.num_observations },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-900 mb-4">Risk Metrics</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((item) => (
          <div key={item.label}>
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              {item.label}
            </div>
            <div className="text-lg font-bold text-gray-900">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectorChart({ sectors }) {
  if (!sectors?.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-gray-500">
        No positions to analyze.
      </div>
    );
  }

  const pieData = sectors.map((s) => ({
    name: s.sector,
    value: Math.abs(s.value),
    weight: s.weight,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-900 mb-4">Sector Exposure</h2>
      <div className="flex flex-col md:flex-row items-center gap-6">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={110}
              label={({ name, weight }) => `${name} ${weight.toFixed(0)}%`}
              labelLine={{ stroke: "#9ca3af" }}
            >
              {pieData.map((_, i) => (
                <Cell
                  key={i}
                  fill={SECTOR_COLORS[i % SECTOR_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(v) => [formatCurrency(v), "Value"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ConcentrationChart({ positions }) {
  if (!positions?.length) return null;

  const data = positions.slice(0, 10).map((p) => ({
    name: `${p.ticker} (${p.side[0].toUpperCase()})`,
    weight: Math.abs(p.weight),
    value: p.market_value,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-900 mb-4">
        Top Position Concentration
      </h2>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            type="number"
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 12 }}
            width={75}
          />
          <Tooltip
            formatter={(v, name) =>
              name === "weight" ? [`${v.toFixed(1)}%`, "Weight"] : [formatCurrency(v), "Value"]
            }
          />
          <Bar dataKey="weight" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Analytics({ portfolioId }) {
  const [sectors, setSectors] = useState([]);
  const [concentration, setConcentration] = useState([]);
  const [risk, setRisk] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getSectors(portfolioId), getConcentration(portfolioId), getRiskMetrics(portfolioId)])
      .then(([secData, concData, riskData]) => {
        setSectors(secData.sectors || []);
        setConcentration(concData.positions || []);
        setRisk(riskData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [portfolioId]);

  if (loading) {
    return <div className="text-center text-gray-500 py-12">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
      <RiskCard metrics={risk} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectorChart sectors={sectors} />
        <ConcentrationChart positions={concentration} />
      </div>
    </div>
  );
}
