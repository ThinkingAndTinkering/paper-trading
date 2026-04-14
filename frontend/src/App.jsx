import { useState, useEffect, useCallback, useRef } from "react";
import {
  listPortfolios,
  getPortfolio,
  createPortfolio,
  deletePortfolio,
  resetPortfolio,
  renamePortfolio,
  exportData,
  importData,
} from "./api";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Performance from "./pages/Performance";
import Analytics from "./pages/Analytics";

const PAGES = [
  { id: "portfolio", label: "Portfolio" },
  { id: "transactions", label: "Transactions" },
  { id: "performance", label: "Performance" },
  { id: "analytics", label: "Analytics" },
];

function CreatePortfolioForm({ onCreated, onCancel }) {
  const [name, setName] = useState("");
  const [deposit, setDeposit] = useState("100000");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const result = await createPortfolio({
        name: name.trim(),
        initial_deposit: parseFloat(deposit),
      });
      onCreated(result.id);
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 max-w-md mx-auto mt-12">
      <h2 className="text-lg font-bold text-gray-900 mb-4">
        Create New Portfolio
      </h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Portfolio Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Growth Strategy, Value Picks..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Initial Deposit ($)
          </label>
          <input
            type="number"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Portfolio"}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2.5 text-gray-600 hover:text-gray-900 rounded-lg border border-gray-300 font-medium"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PortfolioSelector({
  portfolios,
  activeId,
  onSelect,
  onCreateNew,
  onDelete,
  onReset,
  onRename,
  onReorder,
}) {
  const [menuId, setMenuId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'delete'|'reset', id, name }
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [renameValue, setRenameValue] = useState("");
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  const menuRef = useRef(null);

  // Close menu when clicking anywhere outside
  useEffect(() => {
    if (!menuId) return;
    const handler = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenuId(null);
    };
    const timer = setTimeout(() => {
      window.addEventListener("click", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handler);
    };
  }, [menuId]);

  const handleDragStart = (idx) => {
    dragItem.current = idx;
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    dragOverItem.current = idx;
  };

  const handleDrop = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;
    const reordered = [...portfolios];
    const [moved] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, moved);
    onReorder(reordered.map((p) => p.id));
    dragItem.current = null;
    dragOverItem.current = null;
  };

  return (
    <>
      {/* Rename modal */}
      {renaming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[100]" onClick={() => setRenaming(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-lg mb-3">Rename Portfolio</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) {
                  onRename(renaming.id, renameValue.trim());
                  setRenaming(null);
                }
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (renameValue.trim()) {
                    onRename(renaming.id, renameValue.trim());
                    setRenaming(null);
                  }
                }}
                disabled={!renameValue.trim()}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                Rename
              </button>
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[100]" onClick={() => setConfirmAction(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-lg mb-2">
              {confirmAction.type === "delete" ? "Delete" : "Reset"} &ldquo;{confirmAction.name}&rdquo;?
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {confirmAction.type === "delete"
                ? "This will permanently delete this portfolio and all its positions, transactions, and snapshots. This cannot be undone."
                : "This will close all positions, clear all transactions and snapshots, and reset the cash balance. This cannot be undone."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  if (action.type === "delete") await onDelete(action.id);
                  else await onReset(action.id, action.name);
                }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium text-white ${
                  confirmAction.type === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                Yes, {confirmAction.type === "delete" ? "Delete" : "Reset"} Portfolio
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 relative">
        {portfolios.map((p, idx) => (
          <div
            key={p.id}
            className="relative flex-shrink-0"
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={handleDrop}
          >
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => { onSelect(p.id); setMenuId(null); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-grab active:cursor-grabbing ${
                  activeId === p.id
                    ? "bg-blue-100 text-blue-800 border border-blue-200"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-transparent"
                }`}
              >
                {p.name}
              </button>
              <button
                type="button"
                data-portfolio-menu
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuId(menuId === p.id ? null : p.id);
                }}
                className="ml-0.5 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
                title="Portfolio options"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="3.5" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="12.5" r="1.5" />
                </svg>
              </button>
            </div>
            {menuId === p.id && (
              <div ref={menuRef} data-portfolio-menu className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-36">
                <button
                  type="button"
                  onClick={() => {
                    setMenuId(null);
                    setRenameValue(p.name);
                    setRenaming({ id: p.id, name: p.name });
                  }}
                  className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 w-full text-left whitespace-nowrap"
                >
                  Rename Portfolio
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuId(null);
                    setConfirmAction({ type: "reset", id: p.id, name: p.name });
                  }}
                  className="px-4 py-1.5 text-sm text-amber-700 hover:bg-amber-50 w-full text-left whitespace-nowrap"
                >
                  Reset Portfolio
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuId(null);
                    setConfirmAction({ type: "delete", id: p.id, name: p.name });
                  }}
                  className="px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 w-full text-left whitespace-nowrap"
                >
                  Delete Portfolio
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={onCreateNew}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 border border-dashed border-blue-300 flex-shrink-0"
        >
          + New
        </button>
      </div>
    </>
  );
}

export default function App() {
  const [page, setPage] = useState("portfolio");
  const [portfolios, setPortfolios] = useState([]);
  const [activePortfolioId, setActivePortfolioId] = useState(null);
  const [activePortfolio, setActivePortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const handleExport = async () => {
    try {
      const data = await exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paper-trading-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export failed: " + e.message);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await importData(file);
      alert(`Imported ${result.imported} of ${result.total} portfolios.`);
      const ps = await loadPortfolios();
      if (ps.length > 0 && !activePortfolioId) {
        setActivePortfolioId(ps[0].id);
        refreshActive(ps[0].id);
      }
    } catch (e) {
      alert("Import failed: " + e.message);
    }
    e.target.value = "";
  };

  const loadPortfolios = useCallback(async () => {
    try {
      const data = await listPortfolios();
      let ps = data.portfolios || [];
      // Apply saved order
      const savedOrder = JSON.parse(localStorage.getItem("portfolioOrder") || "[]");
      if (savedOrder.length > 0) {
        const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
        ps.sort((a, b) => {
          const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
          const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
          return ai - bi;
        });
      }
      setPortfolios(ps);
      return ps;
    } catch {
      setPortfolios([]);
      return [];
    }
  }, []);

  const refreshActive = useCallback(async (id) => {
    if (!id) return;
    try {
      const data = await getPortfolio(id);
      setActivePortfolio(data);
    } catch {
      setActivePortfolio(null);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadPortfolios().then((ps) => {
      if (ps.length > 0) {
        const savedId = localStorage.getItem("activePortfolioId");
        const id =
          savedId && ps.find((p) => p.id === parseInt(savedId))
            ? parseInt(savedId)
            : ps[0].id;
        setActivePortfolioId(id);
        refreshActive(id);
      }
      setLoading(false);
    });
  }, [loadPortfolios, refreshActive]);

  // Persist active portfolio
  useEffect(() => {
    if (activePortfolioId) {
      localStorage.setItem("activePortfolioId", activePortfolioId);
    }
  }, [activePortfolioId]);

  const handleSelectPortfolio = (id) => {
    setActivePortfolioId(id);
    refreshActive(id);
    setCreating(false);
  };

  const handleCreated = async (newId) => {
    await loadPortfolios();
    setActivePortfolioId(newId);
    await refreshActive(newId);
    setCreating(false);
  };

  const handleDelete = async (id) => {
    try {
      await deletePortfolio(id);
      const ps = await loadPortfolios();
      if (ps.length > 0) {
        const newId = ps[0].id;
        setActivePortfolioId(newId);
        await refreshActive(newId);
      } else {
        setActivePortfolioId(null);
        setActivePortfolio(null);
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRename = async (id, newName) => {
    try {
      await renamePortfolio(id, newName);
      await loadPortfolios();
      if (id === activePortfolioId) await refreshActive(id);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleReset = async (id, name) => {
    try {
      await resetPortfolio(id, { name, initial_deposit: 100000 });
      await loadPortfolios();
      await refreshActive(id);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleReorder = (orderedIds) => {
    localStorage.setItem("portfolioOrder", JSON.stringify(orderedIds));
    // Re-sort current portfolios in place
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
    setPortfolios((prev) =>
      [...prev].sort((a, b) => {
        const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
        const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
        return ai - bi;
      })
    );
  };

  const handleUpdate = () => {
    refreshActive(activePortfolioId);
    loadPortfolios();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500 text-lg">Loading...</div>
      </div>
    );
  }

  // No portfolios at all — show create form full screen
  if (portfolios.length === 0 && !creating) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <CreatePortfolioForm onCreated={handleCreated} />
      </div>
    );
  }

  const renderPage = () => {
    if (creating) {
      return (
        <CreatePortfolioForm
          onCreated={handleCreated}
          onCancel={() => setCreating(false)}
        />
      );
    }

    if (!activePortfolio) {
      return (
        <div className="text-center text-gray-500 py-12">
          Select a portfolio above.
        </div>
      );
    }

    const pid = activePortfolioId;

    switch (page) {
      case "transactions":
        return <Transactions portfolioId={pid} />;
      case "performance":
        return <Performance portfolioId={pid} />;
      case "analytics":
        return <Analytics portfolioId={pid} />;
      default:
        return (
          <Dashboard portfolio={activePortfolio} onUpdate={handleUpdate} />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 overflow-visible">
        <div className="max-w-[1400px] mx-auto px-4 overflow-visible">
          <div className="flex items-center h-14 gap-1 overflow-visible">
            <span className="font-bold text-gray-900 mr-4 text-lg flex-shrink-0">
              Paper Trading
            </span>
            <div className="border-r border-gray-200 h-8 mr-3" />
            <PortfolioSelector
              portfolios={portfolios}
              activeId={activePortfolioId}
              onSelect={handleSelectPortfolio}
              onCreateNew={() => setCreating(true)}
              onDelete={handleDelete}
              onReset={handleReset}
              onRename={handleRename}
              onReorder={handleReorder}
            />
            <div className="border-r border-gray-200 h-8 mx-3" />
            <div className="flex items-center gap-1">
              {PAGES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPage(p.id);
                    setCreating(false);
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    page === p.id && !creating
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handleExport}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 border border-gray-200"
                title="Export all portfolios"
              >
                Export
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 border border-gray-200"
                title="Import portfolios from JSON"
              >
                Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
              <div className="flex bg-gray-100 border border-gray-200 rounded-lg p-0.5 ml-1">
                <button
                  onClick={() => setTheme("dark")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    theme === "dark"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Dark
                </button>
                <button
                  onClick={() => setTheme("light")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    theme === "light"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Light
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-[1400px] mx-auto px-4 py-6">{renderPage()}</main>
    </div>
  );
}
