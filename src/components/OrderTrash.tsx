import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { ordersApi } from "../lib/api";
import { formatCurrency, formatDateTime } from "../lib/format";
import PageHeader from "./PageHeader";

const PAGE_SIZE = 10;

interface TrashOrder {
  id: string;
  order_number: number;
  supplier_name: string;
  total: number;
  created_by_name: string;
  excluido_por_nome: string;
  excluido_em: string;
}

export default function OrderTrash({ onBack }: { onBack: () => void }) {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<TrashOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [permanent, setPermanent] = useState<TrashOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await ordersApi.trash(page, PAGE_SIZE);
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setOrders(result.orders as TrashOrder[]);
      setTotal(result.total);
    } catch (caught: any) {
      setError("Erro ao carregar a lixeira.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!permanent) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPermanent(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [permanent]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title="Lixeira"
        subtitle="Pedidos removidos do histórico"
      />

      <div className="relative min-h-80 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-slate-500">Carregando...</div>
        ) : error ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-red-600">{error}</div>
        ) : orders.length === 0 ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-slate-400">A lixeira está vazia</div>
        ) : (
          <table className="orders-table w-full min-w-[64rem]">
            <thead>
              <tr className="table-header text-xs text-slate-300">
                <th className="px-4 py-3 text-left font-medium">Nº</th>
                <th className="px-4 py-3 text-left font-medium">Fornecedor</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-left font-medium">Feito por</th>
                <th className="px-4 py-3 text-left font-medium">Excluído por</th>
                <th className="px-4 py-3 text-left font-medium">Excluído em</th>
                <th className="px-4 py-3 text-center font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="order-row border-t text-sm">
                  <td className="px-4 py-3 font-mono font-bold text-blue-700">#{order.order_number}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{order.supplier_name}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(order.total)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {order.created_by_name || "Não identificado"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{order.excluido_por_nome}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(order.excluido_em)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await ordersApi.restore(order.id);
                            window.dispatchEvent(new Event("tecar:notes-changed"));
                            await load();
                          } catch (caught: any) {
                            setError("Não foi possível restaurar o pedido.");
                          }
                        }}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Restaurar
                      </button>
                      {profile?.is_admin && (
                        <button
                          type="button"
                          onClick={() => setPermanent(order)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Excluir definitivamente
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Mostrando {start}–{end} de {total} pedidos</p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-40">Anterior</button>
          <span className="text-xs text-slate-500">{page} / {totalPages}</span>
          <button type="button" disabled={page === totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-40">Próximo</button>
        </div>
      </div>

      {permanent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="font-semibold text-slate-800">Excluir definitivamente o pedido #{permanent.order_number}?</h2>
            <p className="mt-2 text-sm font-medium text-red-600">Esta ação não pode ser desfeita.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setPermanent(null)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm">Cancelar</button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await ordersApi.permanentlyDelete(permanent.id);
                    window.dispatchEvent(new Event("tecar:notes-changed"));
                    setPermanent(null);
                    await load();
                  } catch (caught: any) {
                    setError("Não foi possível excluir o pedido.");
                  }
                }}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white"
              >
                Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
