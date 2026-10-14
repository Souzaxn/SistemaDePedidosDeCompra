import { useState, useEffect, useRef } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  useLocation,
  useNavigate,
} from "react-router";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Login from "./components/Login";
import OrderHistory from "./components/OrderHistory";
import OrderForm from "./components/OrderForm";
import OrderView from "./components/OrderView";
import SetupScreen from "./components/SetupScreen";
import InventorySettings from "./components/InventorySettings";
import StockSearch from "./components/StockSearch";
import Suppliers from "./components/Suppliers";
import InvoiceNotes, { InvoiceNoteDetails } from "./components/InvoiceNotes";
import { notesApi, ordersApi } from "./lib/api";
import tecarLogo from "./imports/image-1.png";

type Screen =
  | { name: "history" }
  | { name: "new" }
  | { name: "edit"; id: string }
  | { name: "view"; id: string }
  | { name: "suppliers" };

type Theme = "light" | "dark";

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={onToggle}
      className="theme-toggle"
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 15.2A9 9 0 1 1 8.8 3 7 7 0 0 0 21 15.2Z" />
        </svg>
      )}
      <span>{isDark ? "Modo claro" : "Modo escuro"}</span>
    </button>
  );
}

function BrandCorner() {
  return (
    <div className="brand-corner" aria-label="Grupo Tecar">
      <img src={tecarLogo} alt="Grupo Tecar" />
    </div>
  );
}

function Shell({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, loading, signOut } = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: "history" });
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [dbReady, setDbReady] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [stockDrawerOpen, setStockDrawerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingNotes, setPendingNotes] = useState(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  const isStockPage = location.pathname === "/estoque";
  const isNotesPage = location.pathname === "/notas";
  const noteDetailId = location.pathname.match(/^\/notas\/([^/]+)$/)?.[1] ?? null;
  const isOrderScreen =
    !isStockPage && !isNotesPage && !noteDetailId &&
    (screen.name === "new" || screen.name === "edit");

  useEffect(() => {
    if (user) {
      ordersApi.checkSetup().then(setDbReady);
    }
  }, [user]);

  useEffect(() => {
    if (!user || !dbReady) return;
    const refresh = () => notesApi.pendingCount().then(setPendingNotes).catch(() => undefined);
    void refresh();
    window.addEventListener("tecar:notes-changed", refresh);
    return () => window.removeEventListener("tecar:notes-changed", refresh);
  }, [user, dbReady]);

  useEffect(() => {
    if (!stockDrawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStockDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [stockDrawerOpen]);

  useEffect(() => {
    if (!isOrderScreen) setStockDrawerOpen(false);
  }, [isOrderScreen]);

  useEffect(() => {
    if (!showSettings) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setShowSettings(false);
        return;
      }
      if (event instanceof MouseEvent && !settingsRef.current?.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [showSettings]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (loading) {
    return (
      <div className="app-canvas min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  if (dbReady === null) {
    return (
      <div className="app-canvas min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Verificando banco de dados...</p>
        </div>
      </div>
    );
  }

  if (dbReady === false) {
    return <SetupScreen onRetry={() => ordersApi.checkSetup().then(setDbReady)} />;
  }

  const goToHistory = () => {
    setScreen({ name: "history" });
    if (location.pathname !== "/") navigate("/");
  };

  const leaveStockPage = () => {
    const historyIndex = window.history.state?.idx ?? 0;
    if (historyIndex > 0) {
      navigate(-1);
    } else {
      setScreen({ name: "history" });
      navigate("/", { replace: true });
    }
  };

  return (
    <div
      className={`app-canvas relative min-h-screen bg-slate-50 pb-20 ${
        stockDrawerOpen ? "stock-drawer-open" : ""
      }`}
    >
      <nav className="bg-slate-900 border-b border-slate-800 px-4 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 h-12 whitespace-nowrap">
          <div className="flex min-w-0 items-center gap-3 relative">
            <button
              onClick={goToHistory}
              className="shrink-0 text-white font-bold text-sm tracking-tight cursor-pointer hover:text-blue-300 transition"
            >
              <span className="hidden sm:inline">TECAR · Pedidos de Compra</span>
              <span className="sm:hidden">TECAR</span>
            </button>
            {(isStockPage || isNotesPage || noteDetailId || screen.name !== "history") && (
              <div className="hidden xl:flex min-w-0 items-center gap-3">
                <span className="text-slate-600">/</span>
                <span className="truncate text-slate-400 text-sm">
                  {isStockPage
                    ? "Consultar estoque"
                    : isNotesPage || noteDetailId
                      ? "Conferir Notas"
                    : screen.name === "new"
                      ? "Novo Pedido"
                      : screen.name === "edit"
                        ? "Editar Pedido"
                        : screen.name === "view"
                          ? "Visualizar Pedido"
                          : screen.name === "suppliers"
                            ? "Fornecedores"
                            : ""}
                </span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[var(--color-white)] text-xs hidden sm:block max-w-32 truncate">{profile?.name}</span>
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const openAsDrawer = isOrderScreen && !showSettings;
                setShowSettings(false);
                if (openAsDrawer) {
                  setStockDrawerOpen((current) => !current);
                } else {
                  setStockDrawerOpen(false);
                  navigate("/estoque");
                }
              }}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs cursor-pointer transition"
              title="Consultar estoque"
              aria-expanded={stockDrawerOpen}
              aria-controls="stock-drawer"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="6.5"
                  stroke="var(--color-white)"
                  strokeWidth={1.8}
                />
                <path
                  d="m16 16 4 4"
                  stroke="var(--color-white)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              </svg>
              <span className="hidden md:inline text-[var(--color-white)]">Consultar estoque</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSettings(false);
                setStockDrawerOpen(false);
                setScreen({ name: "suppliers" });
                if (location.pathname !== "/") navigate("/");
              }}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs cursor-pointer transition"
              title="Fornecedores"
            >
              <svg className="h-4 w-4" fill="none" stroke="var(--color-white)" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span className="hidden md:inline text-[var(--color-white)]">Fornecedores</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSettings(false);
                setStockDrawerOpen(false);
                navigate("/notas");
              }}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs cursor-pointer transition"
              title="Conferir Notas"
            >
              <svg className="h-4 w-4" fill="none" stroke="var(--color-white)" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 6h11M9 12h11M9 18h11M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
              </svg>
              <span className="hidden md:inline text-[var(--color-white)]">Conferir Notas</span>
              {pendingNotes > 0 && (
                <span className="min-w-5 rounded-full bg-amber-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-slate-950">
                  {pendingNotes}
                </span>
              )}
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                setStockDrawerOpen(false);
                setShowSettings((current) => !current);
              }}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs cursor-pointer transition"
              aria-expanded={showSettings}
              aria-haspopup="dialog"
              title="Configurações"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke="var(--color-white)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M9.6 3.2l.5 1.7a7.7 7.7 0 013.8 0l.5-1.7 2.5 1.4-.8 1.6a7.5 7.5 0 011.9 3.3l1.8.1v2.8l-1.8.1a7.5 7.5 0 01-1.9 3.3l.8 1.6-2.5 1.4-.5-1.7a7.7 7.7 0 01-3.8 0l-.5 1.7-2.5-1.4.8-1.6A7.5 7.5 0 016 12.5l-1.8-.1V9.6L6 9.5a7.5 7.5 0 011.9-3.3l-.8-1.6 2.5-1.4z"
                />
                <circle cx="12" cy="11" r="2.5" stroke="var(--color-white)" />
              </svg>
              <span className="hidden md:inline text-[var(--color-white)]">Configurações</span>
            </button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button onClick={signOut} className="text-[var(--color-white)] hover:text-slate-300 text-xs cursor-pointer transition">Sair</button>
            {showSettings && (
              <div
                ref={settingsRef}
                className="settings-popover fixed right-2 top-14 z-[80] bg-white border border-slate-200 rounded-xl shadow-xl p-4"
                role="dialog"
                aria-label="Configurações"
              >
                <InventorySettings />
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="app-content">
        {isStockPage ? (
          <StockSearch onBack={leaveStockPage} />
        ) : isNotesPage ? (
          <InvoiceNotes onBack={goToHistory} />
        ) : noteDetailId ? (
          <InvoiceNoteDetails
            orderId={noteDetailId}
            onViewOrder={() => {
              setScreen({ name: "view", id: noteDetailId });
              navigate("/");
            }}
          />
        ) : screen.name === "history" ? (
          <OrderHistory
            onView={(id) => setScreen({ name: "view", id })}
            onEdit={(id) => setScreen({ name: "edit", id })}
            onNew={() => setScreen({ name: "new" })}
            refresh={historyRefresh}
          />
        ) : screen.name === "new" ? (
          <OrderForm
            onBack={() => setScreen({ name: "history" })}
            onSaved={(message) => { setHistoryRefresh((n) => n + 1); setScreen({ name: "history" }); if (message) setNotice(message); }}
          />
        ) : screen.name === "edit" ? (
          <OrderForm
            editId={screen.id}
            onBack={() => setScreen({ name: "history" })}
            onSaved={(message) => { setHistoryRefresh((n) => n + 1); setScreen({ name: "history" }); if (message) setNotice(message); }}
          />
        ) : screen.name === "view" ? (
          <OrderView
            orderId={screen.id}
            onBack={() => setScreen({ name: "history" })}
            onEdit={() => setScreen({ name: "edit", id: screen.id })}
            canEdit={true}
          />
        ) : screen.name === "suppliers" ? (
          <Suppliers />
        ) : null}
      </main>

      {isOrderScreen && (
        <aside
          id="stock-drawer"
          role="dialog"
          aria-modal="false"
          aria-label="Consultar estoque"
          aria-hidden={!stockDrawerOpen}
          inert={!stockDrawerOpen}
          className={`stock-drawer fixed bottom-0 right-0 top-12 z-50 bg-white shadow-2xl transition-transform duration-300 ${
            stockDrawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <StockSearch
            variant="drawer"
            onClose={() => setStockDrawerOpen(false)}
            canAddToOrder
          />
        </aside>
      )}
      {notice && (
        <div className="fixed bottom-5 right-5 z-[90] max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-xl">
          {notice}
        </div>
      )}
      <BrandCorner />
    </div>
  );
}

function RoutedApp() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("tecar-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("tecar-theme", theme);
  }, [theme]);

  return (
    <>
      <AuthProvider>
        <Shell
          theme={theme}
          onToggleTheme={() =>
            setTheme((current) => current === "dark" ? "light" : "dark")
          }
        />
      </AuthProvider>
    </>
  );
}

const router = createBrowserRouter([
  {
    path: "*",
    Component: RoutedApp,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
