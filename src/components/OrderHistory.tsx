import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { ordersApi } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { printOrderPDF, reserveMobilePrintWindow } from "../lib/pdf";
import PageHeader from "./PageHeader";

const PAGE_SIZE = 10;

interface Order {
  id: string;
  order_number: number;
  supplier_name: string;
  created_by: string;
  created_by_name: string;
  issued_at: string;
  total: number;
}

interface Props {
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onNew: () => void;
  onTrash: () => void;
  refresh: number;
}

const getVisiblePages = (current: number, total: number) => {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 3) return [1, 2, 3, 4, "ellipsis-right", total];
  if (current >= total - 2) {
    return [1, "ellipsis-left", total - 3, total - 2, total - 1, total];
  }
  return [
    1,
    "ellipsis-left",
    current - 1,
    current,
    current + 1,
    "ellipsis-right",
    total,
  ];
};

export default function OrderHistory({ onView, onEdit, onDuplicate, onNew, onTrash, refresh }: Props) {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterNumber, setFilterNumber] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [page, setPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [trashCount, setTrashCount] = useState(0);
  const [undo, setUndo] = useState<{ id: string; number: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    try {
      const result = await ordersApi.list({
        supplier: filterSupplier || undefined,
        number: filterNumber || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setOrders(result.orders);
      setTotalOrders(result.total);
    } catch (err: any) {
      setFetchError(err?.message || "Erro ao carregar pedidos.");
    } finally {
      setLoading(false);
    }
  }, [filterSupplier, filterNumber, filterDateFrom, filterDateTo, page]);

  useEffect(() => {
    void load();
    void ordersApi.trashCount().then(setTrashCount).catch(() => setTrashCount(0));
  }, [load, refresh]);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-page-search]")?.focus();
      } else if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        onNew();
      } else if (event.key === "Escape") {
        setConfirmDelete(null);
        setUndo(null);
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [onNew]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const order = orders.find((item) => item.id === id);
      await ordersApi.moveToTrash(id);
      const nextTotal = Math.max(0, totalOrders - 1);
      const lastPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
      setTotalOrders(nextTotal);
      if (page > lastPage) setPage(lastPage);
      else await load();
      setTrashCount((value) => value + 1);
      if (order) setUndo({ id, number: order.order_number });
      window.dispatchEvent(new Event("tecar:notes-changed"));
    } catch (err: any) {
      alert(err?.message || "Erro ao excluir pedido.");
    }
    setDeleting(null);
    setConfirmDelete(null);
  };

  const canEdit = (o: Order) => profile?.is_admin || o.created_by === profile?.id;
  const handlePrint = async (id: string) => {
    const reservedWindow = reserveMobilePrintWindow();
    setPrintingId(id);
    try {
      const order = await ordersApi.get(id);
      await printOrderPDF(order, reservedWindow);
    } catch (error: any) {
      reservedWindow?.close();
      alert(error?.message || "Não foi possível abrir a impressão.");
    } finally {
      setPrintingId(null);
    }
  };
  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));
  const rangeStart = totalOrders === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, totalOrders);
  const visiblePages = getVisiblePages(page, totalPages);

  const searchFirstPage = () => {
    if (page === 1) void load();
    else setPage(1);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <PageHeader
        title="Histórico de Pedidos"
        subtitle="Todos os pedidos de compra da empresa"
        actions={
          <>
          <button type="button" onClick={onTrash} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50">
            Lixeira
            {trashCount > 0 && <span className="min-w-5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{trashCount}</span>}
          </button>
          <button
            onClick={onNew}
            title="Novo pedido (N)"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition cursor-pointer shadow-sm"
          >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Novo Pedido
          </button>
          </>
        }
      />

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-5 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--color-black)] mb-1 block">Fornecedor</label>
            <input
              data-page-search
              value={filterSupplier}
              onChange={(e) => { setFilterSupplier(e.target.value); setPage(1); }}
              placeholder="Filtrar por fornecedor..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-black)] mb-1 block">Nº do Pedido</label>
            <input
              value={filterNumber}
              onChange={(e) => { setFilterNumber(e.target.value); setPage(1); }}
              type="number"
              placeholder="Ex: 42"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-black)] mb-1 block">Data de</label>
            <input
              value={filterDateFrom}
              onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-black)] mb-1 block">Data até</label>
            <input
              value={filterDateTo}
              onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex justify-end mt-3 gap-2">
          <button
            onClick={() => {
              setFilterSupplier("");
              setFilterNumber("");
              setFilterDateFrom("");
              setFilterDateTo("");
              setPage(1);
            }}
            className="text-xs text-[var(--color-black)] hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 cursor-pointer transition"
          >
            Limpar
          </button>
          <button
            onClick={searchFirstPage}
            className="text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-1.5 font-medium cursor-pointer transition"
          >
            Buscar
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden min-h-[31rem]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-slate-500 text-sm gap-2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Carregando...
          </div>
        )}
        {fetchError ? (
          <div className="flex flex-col items-center justify-center min-h-[31rem] text-red-500 gap-2 text-sm">
            <p>{fetchError}</p>
            <button onClick={load} className="text-blue-600 text-xs underline cursor-pointer">Tentar novamente</button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[31rem] text-slate-400 gap-2">
            <svg className="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Nenhum pedido encontrado.</p>
            <button onClick={onNew} className="text-blue-600 text-xs font-medium cursor-pointer hover:underline">Criar primeiro pedido</button>
          </div>
        ) : (
          <table className="orders-table w-full">
            <thead>
              <tr className="table-header text-slate-300 text-xs">
                <th className="px-4 py-3 text-left font-medium w-16">Nº</th>
                <th className="px-4 py-3 text-left font-medium">Fornecedor</th>
                <th className="px-4 py-3 text-left font-medium">Data</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-left font-medium">Feito por</th>
                <th className="px-4 py-3 text-center font-medium w-28">Ações</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="order-row text-sm border-t transition cursor-pointer"
                  onClick={() => onView(order.id)}
                >
                  <td className="px-4 py-3 font-mono font-bold text-blue-700">#{order.order_number}</td>
                  <td className="px-4 py-3 text-slate-800 font-medium">{order.supplier_name}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(order.issued_at)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">{formatCurrency(order.total)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {order.created_by_name || "Não identificado"}
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        disabled={printingId === order.id}
                        onClick={() => void handlePrint(order.id)}
                        className="text-slate-400 hover:text-blue-600 cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={printingId === order.id ? "Preparando impressão..." : "Imprimir"}
                        aria-label={printingId === order.id ? "Preparando impressão..." : `Imprimir pedido ${order.order_number}`}
                      >
                        {printingId === order.id ? (
                          <span className="block h-4 w-4 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12-4h12v7H6v-7Z" />
                          </svg>
                        )}
                      </button>
                      <button onClick={() => onDuplicate(order.id)} className="text-slate-400 hover:text-blue-600 cursor-pointer transition" title="Duplicar pedido">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 8h10a2 2 0 0 1 2 2v10H10a2 2 0 0 1-2-2V8Zm0 8H4V4h12v4" />
                        </svg>
                      </button>
                      {canEdit(order) && (
                        <>
                        <button onClick={() => onEdit(order.id)} className="text-slate-400 hover:text-blue-600 cursor-pointer transition" title="Editar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => setConfirmDelete(order.id)} className="text-slate-400 hover:text-red-500 cursor-pointer transition" title="Mover para a lixeira">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-black)]">
          Mostrando {rangeStart}–{rangeEnd} de {totalOrders} pedidos
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page === 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-black)] hover:bg-slate-50 opacity-100 disabled:opacity-100 disabled:cursor-not-allowed cursor-pointer"
          >
            Anterior
          </button>
          {visiblePages.map((item) =>
            typeof item === "number" ? (
              <button
                type="button"
                key={item}
                disabled={loading}
                onClick={() => setPage(item)}
                aria-current={item === page ? "page" : undefined}
                className={`w-8 h-8 rounded-lg text-xs font-semibold cursor-pointer disabled:cursor-not-allowed ${
                  item === page
                    ? "bg-blue-600 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                } ${
                  [2, 3, 4, 10].includes(item)
                    ? "text-[var(--color-black)]"
                    : ""
                }`}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="w-6 text-center text-xs text-[var(--color-black)]">
                ...
              </span>
            ),
          )}
          <button
            type="button"
            disabled={page === totalPages || loading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-black)] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Próximo
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-slate-800 mb-2">Mover pedido para a lixeira?</h3>
            <p className="text-slate-500 text-sm mb-5">
              Mover o pedido #{orders.find((order) => order.id === confirmDelete)?.order_number} para a lixeira? Você poderá restaurá-lo depois.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition">
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={!!deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-semibold rounded-xl py-2.5 text-sm cursor-pointer transition"
              >
                {deleting ? "Movendo..." : "Mover"}
              </button>
            </div>
          </div>
        </div>
      )}
      {undo && (
        <div className="fixed bottom-5 right-5 z-[90] rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-xl">
          Pedido movido para a lixeira ·{" "}
          <button
            type="button"
            className="font-semibold text-blue-600 hover:underline"
            onClick={async () => {
              await ordersApi.restore(undo.id);
              setUndo(null);
              setTrashCount((value) => Math.max(0, value - 1));
              window.dispatchEvent(new Event("tecar:notes-changed"));
              await load();
            }}
          >
            Desfazer
          </button>
        </div>
      )}
    </div>
  );
}
