import { useState, useEffect, useRef, useCallback } from "react";
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
import InventorySettings from "./components/InventorySettings";
import StockSearch from "./components/StockSearch";
import Suppliers from "./components/Suppliers";
import InvoiceNotes, { InvoiceNoteDetails } from "./components/InvoiceNotes";
import OrderTrash from "./components/OrderTrash";
import { SidebarToggleProvider } from "./components/PageHeader";
import SecureErrorBoundary, { SecureErrorScreen } from "./components/SecureErrorBoundary";
import { notesApi, ordersApi } from "./lib/api";
import { supabaseConfigured, verifySupabaseConnection } from "./lib/supabase";
import tecarLogo from "./imports/image-1.png";

const SIDEBAR_STORAGE_KEY = "tecar-sidebar-collapsed";

type Screen =
  | { name: "history" }
  | { name: "new" }
  | { name: "edit"; id: string }
  | { name: "duplicate"; id: string }
  | { name: "view"; id: string }
  | { name: "suppliers" };

function BrandCorner() {
  return (
    <div className="brand-corner" aria-label="Grupo Tecar">
      <img src={tecarLogo} alt="Grupo Tecar" />
    </div>
  );
}

function SidebarIcon({ name }: { name: "history" | "new" | "stock" | "suppliers" | "notes" | "settings" }) {
  const paths = {
    history: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 9h6m-6 4h6m-6 4h4" /></>,
    new: <path d="M12 5v14M5 12h14" />,
    stock: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></>,
    suppliers: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 2.5 4.3V20" /></>,
    notes: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.6l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.8 2h-3l-.7 2.4a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.6l-2 .7v3l2 .7a7 7 0 0 0 .7 1.6l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2.4h3l.7-2.4a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.6l2-.7Z" transform="translate(2.2 0) scale(.82)" /></>,
  };
  return <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, loading, error: authError, signOut } = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: "history" });
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [systemStatus, setSystemStatus] = useState<"idle" | "checking" | "ready" | "failed">("idle");
  const [showSettings, setShowSettings] = useState(false);
  const [stockDrawerOpen, setStockDrawerOpen] = useState(false);
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved !== null) return saved === "true";
    return window.matchMedia("(max-width: 1023px)").matches;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingNotes, setPendingNotes] = useState(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  const stockReturnFocus = useRef<HTMLElement | null>(null);
  const isStockPage = location.pathname === "/estoque";
  const isNotesPage = location.pathname === "/notas";
  const isTrashPage = location.pathname === "/lixeira";
  const noteDetailId = location.pathname.match(/^\/notas\/([^/]+)$/)?.[1] ?? null;
  const isOrderScreen =
    !isStockPage && !isNotesPage && !isTrashPage && !noteDetailId &&
    (screen.name === "new" || screen.name === "edit" || screen.name === "duplicate");
  const userName = profile?.name?.trim() || user?.email || "";
  const userInitials = userName
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TC";
  const activeNavItem =
    location.pathname === "/estoque"
      ? "stock"
      : location.pathname === "/notas"
        ? "notes"
        : location.pathname === "/" && screen.name === "history"
          ? "history"
          : location.pathname === "/" && screen.name === "new"
            ? "new"
            : location.pathname === "/" && screen.name === "suppliers"
              ? "suppliers"
              : null;
  const notesBadgeContent = pendingNotes === 0 ? "✓" : pendingNotes > 99 ? "99+" : String(pendingNotes);
  const notesTooltip = pendingNotes === 0
    ? "Conferir Notas, tudo conferido"
    : `Conferir Notas, ${pendingNotes} ${pendingNotes === 1 ? "pendente" : "pendentes"}`;
  const notesAriaLabel = pendingNotes === 0
    ? "Nenhuma nota pendente"
    : `${pendingNotes} ${pendingNotes === 1 ? "nota pendente" : "notas pendentes"}`;

  const navigateFromSidebar = useCallback((
    item: "history" | "new" | "stock" | "suppliers" | "notes",
    action: () => void,
  ) => {
    if (activeNavItem === item) {
      if (compactViewport) setMobileMenuOpen(false);
      return;
    }
    action();
    setMobileMenuOpen(false);
    if (!compactViewport) {
      setSidebarCollapsed(true);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
    }
  }, [activeNavItem, compactViewport]);

  useEffect(() => {
    if (!user) {
      setSystemStatus("idle");
      return;
    }
    setSystemStatus("checking");
    ordersApi.list({ page: 1, pageSize: 1 })
      .then(() => setSystemStatus("ready"))
      .catch((caught) => {
        if (import.meta.env.DEV) console.error("System initialization failed", caught);
        setSystemStatus("failed");
      });
  }, [user]);

  useEffect(() => {
    if (!user || systemStatus !== "ready") return;
    const refresh = () => notesApi.pendingCount().then(setPendingNotes).catch(() => undefined);
    void refresh();
    window.addEventListener("tecar:notes-changed", refresh);
    return () => window.removeEventListener("tecar:notes-changed", refresh);
  }, [user, systemStatus]);

  const closeStockDrawer = useCallback(() => {
    setStockDrawerOpen(false);
    window.setTimeout(() => stockReturnFocus.current?.focus(), 0);
  }, []);

  const openStockDrawer = useCallback(() => {
    stockReturnFocus.current = document.activeElement as HTMLElement | null;
    setStockDrawerOpen(true);
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>("[data-stock-code]")?.focus();
    }, 0);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (compactViewport) {
      setMobileMenuOpen((current) => !current);
      return;
    }
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }, [compactViewport]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const updateViewport = () => {
      setCompactViewport(media.matches);
      if (!media.matches) setMobileMenuOpen(false);
    };
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!isOrderScreen) setStockDrawerOpen(false);
  }, [isOrderScreen]);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (event.key === "F2" && isOrderScreen) {
        event.preventDefault();
        if (stockDrawerOpen) closeStockDrawer();
        else openStockDrawer();
        return;
      }
      if (event.key === "Escape") {
        setNotice("");
        setShowSettings(false);
        if (stockDrawerOpen) closeStockDrawer();
        return;
      }
      if (!typing && event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const search = document.querySelector<HTMLInputElement>("[data-page-search]");
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [isOrderScreen, stockDrawerOpen, closeStockDrawer, openStockDrawer, toggleSidebar]);

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

  if (authError) return <SecureErrorScreen />;

  if (!user) return <Login />;

  if (systemStatus === "idle" || systemStatus === "checking") {
    return (
      <div className="app-canvas min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Verificando banco de dados...</p>
        </div>
      </div>
    );
  }

  if (systemStatus === "failed") return <SecureErrorScreen />;

  const goToHistory = () => {
    setScreen({ name: "history" });
    setMobileMenuOpen(false);
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
        sidebarCollapsed ? "sidebar-collapsed" : ""
      } ${
        stockDrawerOpen ? "stock-drawer-open" : ""
      }`}
    >
      {mobileMenuOpen && <button type="button" className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu" />}
      <aside className={`app-sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${mobileMenuOpen ? "is-open" : ""}`}>
        <button type="button" onClick={goToHistory} className="sidebar-brand">
          <span className="sidebar-logo"><img src={tecarLogo} alt="Grupo Tecar" /></span>
          <span className="sidebar-brand-copy">
            <strong>Pedidos de Compra</strong>
            <small>Tecar</small>
          </span>
        </button>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <button
            type="button"
            data-tooltip="Histórico"
            onClick={() => navigateFromSidebar("history", () => {
              setScreen({ name: "history" });
              if (location.pathname !== "/") navigate("/");
            })}
            className={activeNavItem === "history" ? "active" : ""}
          >
            <SidebarIcon name="history" /><span className="sidebar-label">Histórico</span>
          </button>
          <button
            type="button"
            data-tooltip="Novo Pedido"
            onClick={() => navigateFromSidebar("new", () => {
              setScreen({ name: "new" });
              if (location.pathname !== "/") navigate("/");
            })}
            className={activeNavItem === "new" ? "active" : ""}
          >
            <SidebarIcon name="new" /><span className="sidebar-label">Novo Pedido</span>
          </button>
          <button
            type="button"
            data-tooltip="Consultar estoque"
            onClick={() => navigateFromSidebar("stock", () => {
              setShowSettings(false);
              if (isOrderScreen) {
                if (stockDrawerOpen) closeStockDrawer();
                else openStockDrawer();
              } else {
                setStockDrawerOpen(false);
                navigate("/estoque");
              }
            })}
            className={activeNavItem === "stock" ? "active" : ""}
          >
            <SidebarIcon name="stock" /><span className="sidebar-label">Consultar estoque</span>
          </button>
          <button
            type="button"
            data-tooltip="Fornecedores"
            onClick={() => navigateFromSidebar("suppliers", () => {
              setShowSettings(false);
              setStockDrawerOpen(false);
              setScreen({ name: "suppliers" });
              if (location.pathname !== "/") navigate("/");
            })}
            className={activeNavItem === "suppliers" ? "active" : ""}
          >
            <SidebarIcon name="suppliers" /><span className="sidebar-label">Fornecedores</span>
          </button>
          <button
            type="button"
            data-tooltip={notesTooltip}
            title={notesTooltip}
            aria-label={notesAriaLabel}
            onClick={() => navigateFromSidebar("notes", () => {
              setShowSettings(false);
              setStockDrawerOpen(false);
              navigate("/notas");
            })}
            className={activeNavItem === "notes" ? "active" : ""}
          >
            <SidebarIcon name="notes" /><span className="sidebar-label">Conferir Notas</span>
            <span className={`sidebar-badge ${pendingNotes === 0 ? "is-clear" : "is-pending"}`}>
              {notesBadgeContent}
            </span>
          </button>
          <button type="button" data-tooltip="Configurações" onMouseDown={(event) => event.stopPropagation()} onClick={() => { setStockDrawerOpen(false); setMobileMenuOpen(false); setShowSettings((current) => !current); }} className={showSettings ? "open" : ""}>
            <SidebarIcon name="settings" /><span className="sidebar-label">Configurações</span>
          </button>
        </nav>
        <div className="sidebar-user">
          <span className="sidebar-avatar">{userInitials}</span>
          <span className="sidebar-user-copy">
            <strong>{userName}</strong>
            <small>{profile?.is_admin ? "Administrador" : "Usuário"}</small>
          </span>
          <button type="button" className="sidebar-signout" onClick={signOut}>Sair</button>
        </div>
      </aside>
      {showSettings && (
        <div ref={settingsRef} className="settings-popover fixed z-[80] bg-white border border-slate-200 rounded-xl shadow-xl p-4" role="dialog" aria-label="Configurações">
          <InventorySettings />
        </div>
      )}

      <SidebarToggleProvider value={{
        expanded: compactViewport ? mobileMenuOpen : !sidebarCollapsed,
        toggle: toggleSidebar,
      }}>
      <main className={`app-content ${isOrderScreen ? "order-screen-content" : ""}`}>
        {isStockPage ? (
          <StockSearch onBack={leaveStockPage} />
        ) : isTrashPage ? (
          <OrderTrash onBack={goToHistory} />
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
            onDuplicate={(id) => setScreen({ name: "duplicate", id })}
            onNew={() => setScreen({ name: "new" })}
            onTrash={() => navigate("/lixeira")}
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
        ) : screen.name === "duplicate" ? (
          <OrderForm
            duplicateId={screen.id}
            onBack={() => setScreen({ name: "history" })}
            onSaved={(message) => { setHistoryRefresh((n) => n + 1); setScreen({ name: "history" }); if (message) setNotice(message); }}
          />
        ) : screen.name === "view" ? (
          <OrderView
            orderId={screen.id}
            onBack={() => setScreen({ name: "history" })}
            onEdit={() => setScreen({ name: "edit", id: screen.id })}
            onDuplicate={() => setScreen({ name: "duplicate", id: screen.id })}
            canEdit={true}
          />
        ) : screen.name === "suppliers" ? (
          <Suppliers />
        ) : null}
      </main>
      </SidebarToggleProvider>

      {isOrderScreen && (
        <aside
          id="stock-drawer"
          role="dialog"
          aria-modal="false"
          aria-label="Consultar estoque"
          aria-hidden={!stockDrawerOpen}
          inert={!stockDrawerOpen}
          className={`stock-drawer fixed bottom-0 right-0 top-0 z-50 bg-white shadow-2xl transition-transform duration-300 ${
            stockDrawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {stockDrawerOpen && (
            <StockSearch
              variant="drawer"
              onClose={closeStockDrawer}
              canAddToOrder
            />
          )}
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
  const [connectionStatus, setConnectionStatus] = useState<"checking" | "ready" | "failed">(
    supabaseConfigured ? "checking" : "failed",
  );

  useEffect(() => {
    localStorage.removeItem("tecar-theme");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "light";
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    void verifySupabaseConnection().then((connected) => {
      setConnectionStatus(connected ? "ready" : "failed");
    });
  }, []);

  if (connectionStatus === "failed") return <SecureErrorScreen />;
  if (connectionStatus === "checking") {
    return (
      <div className="app-canvas min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    path: "*",
    Component: RoutedApp,
  },
]);

export default function App() {
  return (
    <SecureErrorBoundary>
      <RouterProvider router={router} />
    </SecureErrorBoundary>
  );
}
