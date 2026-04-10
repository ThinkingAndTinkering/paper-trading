import { useState, useEffect } from "react";
import { getTransactions } from "../api";
import { formatCurrency, formatDate, formatPct, pnlColor } from "../utils";

function exportCsv(transactions) {
  const headers = [
    "Date",
    "Type",
    "Ticker",
    "Action",
    "Shares",
    "Price",
    "Total Value",
    "Realized P&L",
    "Notes",
  ];

  const rows = transactions.map((tx) => [
    tx.date || "",
    tx.type || "",
    tx.ticker || "",
    tx.action || "",
    tx.shares ?? "",
    tx.price ?? tx.amount ?? "",
    tx.total_value ?? tx.balance_after ?? "",
    tx.realized_pnl ?? "",
    tx.notes ?? "",
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Transactions({ portfolioId }) {
  const [transactions, setTransactions] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTransactions(portfolioId)
      .then((data) => setTransactions(data.transactions || []))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [portfolioId]);

  const filtered =
    filter === "all"
      ? transactions
      : filter === "trades"
        ? transactions.filter((t) => t.type === "trade")
        : transactions.filter((t) => t.type === "cash");

  if (loading) {
    return <div className="text-center text-gray-500 py-12">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Transaction History</h1>
        <div className="flex items-center gap-3">
          {transactions.length > 0 && (
            <button
              onClick={() => exportCsv(filtered)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50"
            >
              Export CSV
            </button>
          )}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {["all", "trades", "cash"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-sm font-medium capitalize ${
                  filter === f
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          No transactions yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Ticker</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-right px-4 py-3">Shares</th>
                  <th className="text-right px-4 py-3">Price</th>
                  <th className="text-right px-4 py-3">Total</th>
                  <th className="text-right px-4 py-3">Realized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((tx, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          tx.type === "trade"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium">
                      {tx.ticker || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {tx.action ? (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
                            tx.action === "buy" || tx.action === "deposit"
                              ? "bg-emerald-100 text-emerald-700"
                              : tx.action === "sell" || tx.action === "withdraw"
                                ? "bg-red-100 text-red-700"
                                : tx.action === "short"
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-purple-100 text-purple-700"
                          }`}
                        >
                          {tx.action}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-right px-4 py-3 font-mono">
                      {tx.shares ?? "—"}
                    </td>
                    <td className="text-right px-4 py-3 font-mono">
                      {tx.price ? `$${tx.price.toFixed(2)}` : tx.amount ? formatCurrency(tx.amount) : "—"}
                    </td>
                    <td className="text-right px-4 py-3 font-mono">
                      {tx.total_value
                        ? formatCurrency(tx.total_value)
                        : tx.balance_after
                          ? formatCurrency(tx.balance_after)
                          : "—"}
                    </td>
                    <td
                      className={`text-right px-4 py-3 font-mono font-medium ${pnlColor(tx.realized_pnl)}`}
                    >
                      {tx.realized_pnl ? formatCurrency(tx.realized_pnl) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
