const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || err.message || "Request failed");
  }
  return res.json();
}

// Portfolios
export const listPortfolios = () => request("/portfolios");
export const getPortfolio = (id) => request(`/portfolio/${id}`);
export const createPortfolio = (data) =>
  request("/portfolio", { method: "POST", body: JSON.stringify(data) });
export const deletePortfolio = (id) =>
  request(`/portfolio/${id}`, { method: "DELETE" });
export const renamePortfolio = (id, name) =>
  request(`/portfolio/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
export const resetPortfolio = (id, data) =>
  request(`/portfolio/${id}/reset`, {
    method: "POST",
    body: JSON.stringify(data),
  });
export const deposit = (id, amount) =>
  request(`/portfolio/${id}/deposit`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
export const withdraw = (id, amount) =>
  request(`/portfolio/${id}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });

// Trading
export const executeTrade = (data) =>
  request("/trade", { method: "POST", body: JSON.stringify(data) });
export const getQuote = (ticker) => request(`/quote/${ticker}`);
export const searchTicker = (q) => request(`/search?q=${encodeURIComponent(q)}`);
export const refreshPrices = () => request("/refresh", { method: "POST" });

// Positions
export const getPositions = (id) => request(`/positions/${id}`);

// Transactions
export const getTransactions = (id) => request(`/transactions/${id}`);

// Snapshots & Performance
export const generateSnapshot = (id) =>
  request(`/snapshots/${id}/generate`, { method: "POST" });
export const getSnapshots = (id) => request(`/snapshots/${id}`);
export const getPerformance = (id) => request(`/performance/${id}`);

// Analytics
export const getSectors = (id) => request(`/analytics/${id}/sectors`);
export const getConcentration = (id) => request(`/analytics/${id}/concentration`);
export const getRiskMetrics = (id) => request(`/analytics/${id}/risk`);
