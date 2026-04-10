import { useState } from "react";
import { getQuote, executeTrade } from "../api";
import { formatCurrency, formatPct, pnlColor } from "../utils";

export default function Trade({ portfolioId, onTraded }) {
  const [ticker, setTicker] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [action, setAction] = useState("buy");
  const [shares, setShares] = useState("");
  const [tradeLoading, setTradeLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const lookupQuote = async () => {
    if (!ticker.trim()) return;
    setQuoteLoading(true);
    setQuote(null);
    setError("");
    try {
      const q = await getQuote(ticker.trim());
      setQuote(q);
    } catch (e) {
      setError(e.message);
    }
    setQuoteLoading(false);
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
      onTraded();
    } catch (e) {
      setError(e.message);
    }
    setTradeLoading(false);
  };

  const estimatedTotal = quote && shares ? (parseFloat(shares) * quote.price) : 0;

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Execute Trade</h1>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        {/* Ticker lookup */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Ticker Symbol
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && lookupQuote()}
              placeholder="AAPL"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 font-mono uppercase focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={lookupQuote}
              disabled={quoteLoading}
              className="bg-gray-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-900 disabled:opacity-50"
            >
              {quoteLoading ? "..." : "Quote"}
            </button>
          </div>
        </div>

        {/* Quote display */}
        {quote && (
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="font-bold text-lg text-gray-900">
                  {quote.ticker}
                </span>
                <span className="ml-2 text-sm text-gray-500">{quote.name}</span>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold font-mono">
                  ${quote.price.toFixed(2)}
                </div>
                <div className={`text-sm font-mono ${pnlColor(quote.change)}`}>
                  {quote.change >= 0 ? "+" : ""}
                  {quote.change.toFixed(2)} ({formatPct(quote.change_pct)})
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Action
          </label>
          <div className="grid grid-cols-4 gap-2">
            {["buy", "sell", "short", "cover"].map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={`py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
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
        </div>

        {/* Shares */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Shares
          </label>
          <input
            type="number"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="100"
            min="0"
            step="1"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Estimated total */}
        {estimatedTotal > 0 && (
          <div className="flex justify-between items-center bg-gray-50 rounded-lg px-4 py-3">
            <span className="text-sm text-gray-600">Estimated Total</span>
            <span className="font-bold text-lg font-mono">
              {formatCurrency(estimatedTotal)}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm">
            <div className="font-medium">Trade Executed</div>
            <div>
              {result.action.toUpperCase()} {result.shares} {result.ticker} @{" "}
              ${result.price.toFixed(2)} = {formatCurrency(result.total_value)}
            </div>
            {result.realized_pnl !== 0 && (
              <div className={pnlColor(result.realized_pnl)}>
                Realized P&L: {formatCurrency(result.realized_pnl)}
              </div>
            )}
            <div className="text-gray-600 mt-1">
              Cash Balance: {formatCurrency(result.cash_balance)}
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleTrade}
          disabled={tradeLoading || !quote}
          className={`w-full py-3 rounded-lg font-medium text-white disabled:opacity-50 ${
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
