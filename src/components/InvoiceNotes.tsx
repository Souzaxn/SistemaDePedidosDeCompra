import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { InvoiceOrder, notesApi, ordersApi, suppliersApi } from "../lib/api";
import { formatCurrency, formatDate, formatDateOnly, formatDateTime } from "../lib/format";
import { validateStandaloneInvoice } from "../lib/invoices";
import InvoiceNumberEditor from "./InvoiceNumberEditor";
import PageHeader from "./PageHeader";

const PAGE_SIZE = 10;
type StatusFilter = "pending" | "completed" | "all";

const visiblePages = (current: number, total: number) => {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 3) return [1, 2, 3, 4, total];
  if (current >= total - 2) return [1, total - 3, total - 2, total - 1, total];
  return [1, current - 1, current, current + 1, total];
};

const emptyMessage = (status: StatusFilter) =>
  status === "pending"
    ? "Nenhuma nota pendente"
    : status === "completed"
      ? "Nenhuma nota concluída"
      : "Nenhuma nota encontrada";

interface SupplierOption {
  id: string;
  name: string;
  cnpj: string;
}

function StandaloneInvoiceModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [number, setNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [total, setTotal] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [errors, setErrors] = useState<{ number?: string; supplier?: string }>({});
  const [requestError, setRequestError] = useState("");
  const [saving, setSaving] = useState(false);
  const numberRef = useRef<HTMLInputElement>(null);
  const supplierRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    numberRef.current?.focus();
    suppliersApi.list().then(setSuppliers).catch((caught) => {
      setRequestError("Não foi possível carregar os fornecedores.");
    });
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const focusField = (element: HTMLElement | null) => {
    element?.focus();
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const save = async () => {
    const nextErrors = validateStandaloneInvoice(number, supplierId);
    setErrors(nextErrors);
    setRequestError("");
    if (nextErrors.number) {
      focusField(numberRef.current);
      return;
    }
    if (nextErrors.supplier) {
      focusField(supplierRef.current);
      return;
    }

    const normalizedTotal = total.trim().replace(/\./g, "").replace(",", ".");
    const parsedTotal = normalizedTotal ? Number(normalizedTotal) : null;
    if (parsedTotal !== null && !Number.isFinite(parsedTotal)) {
      setRequestError("Informe um valor total válido ou deixe o campo vazio.");
      return;
    }

    setSaving(true);
    try {
      await notesApi.createStandalone({
        nota_numero: number,
        supplier_id: supplierId,
        total: parsedTotal,
      });
      window.dispatchEvent(new Event("tecar:notes-changed"));
      onSaved();
    } catch (caught: any) {
      setRequestError("Não foi possível cadastrar a nota.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="standalone-invoice-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 id="standalone-invoice-title" className="text-base font-semibold text-slate-800">
              Lançar nota fiscal avulsa
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              A data de emissão será registrada automaticamente ao salvar.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <span className="sr-only">Fechar</span>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="standalone-number" className="mb-1 block text-xs font-medium text-slate-600">
              Nº da Nota *
            </label>
            <input
              id="standalone-number"
              ref={numberRef}
              value={number}
              maxLength={20}
              aria-invalid={Boolean(errors.number)}
              aria-describedby={errors.number ? "standalone-number-error" : undefined}
              onChange={(event) => {
                setNumber(event.target.value);
                if (errors.number) setErrors((current) => ({ ...current, number: undefined }));
              }}
              className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                errors.number
                  ? "border-red-500 focus:ring-red-200"
                  : "border-slate-200 focus:ring-blue-500"
              }`}
            />
            {errors.number && (
              <p id="standalone-number-error" className="mt-1 text-xs text-red-600">
                {errors.number}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="standalone-supplier" className="mb-1 block text-xs font-medium text-slate-600">
              Fornecedor *
            </label>
            <select
              id="standalone-supplier"
              ref={supplierRef}
              value={supplierId}
              aria-invalid={Boolean(errors.supplier)}
              aria-describedby={errors.supplier ? "standalone-supplier-error" : undefined}
              onChange={(event) => {
                setSupplierId(event.target.value);
                if (errors.supplier) setErrors((current) => ({ ...current, supplier: undefined }));
              }}
              className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                errors.supplier
                  ? "border-red-500 focus:ring-red-200"
                  : "border-slate-200 focus:ring-blue-500"
              }`}
            >
              <option value="">Selecione um fornecedor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            {errors.supplier && (
              <p id="standalone-supplier-error" className="mt-1 text-xs text-red-600">
                {errors.supplier}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="standalone-total" className="mb-1 block text-xs font-medium text-slate-600">
              Valor total
            </label>
            <input
              id="standalone-total"
              value={total}
              inputMode="decimal"
              placeholder="Opcional"
              onChange={(event) => setTotal(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {requestError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {requestError}
            </p>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar nota"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceNotes({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (["pending", "completed", "all"].includes(params.get("status") ?? "")
    ? params.get("status")
    : "pending") as StatusFilter;
  const search = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [notes, setNotes] = useState<InvoiceOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showStandaloneForm, setShowStandaloneForm] = useState(false);
  const [undo, setUndo] = useState<{
    id: string;
    checked: boolean;
    noteType: "order" | "standalone";
  } | null>(null);

  const updateParams = (changes: Record<string, string | number>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === "" || (key === "page" && Number(value) === 1)) next.delete(key);
      else next.set(key, String(value));
    });
    setParams(next);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await notesApi.list({ status, search, page, pageSize: PAGE_SIZE });
      if (!result.notes.length && page > 1) {
        updateParams({ page: 1 });
        return;
      }
      setNotes(result.notes);
      setTotal(result.total);
    } catch (caught: any) {
      setError("Erro ao carregar as notas.");
    } finally {
      setLoading(false);
    }
  }, [status, search, page]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowStandaloneForm(false);
        setUndo(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const toggle = async (note: InvoiceOrder, checked: boolean) => {
    setNotes((current) =>
      current.map((item) =>
        item.id === note.id ? { ...item, nota_conferida: checked } : item,
      ),
    );
    try {
      await notesApi.setChecked(note.id, checked, note.note_type);
      setUndo(checked ? { id: note.id, checked: false, noteType: note.note_type } : null);
      window.dispatchEvent(new Event("tecar:notes-changed"));
      await load();
    } catch (caught: any) {
      setError("Não foi possível alterar a conferência.");
      await load();
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title="Conferir Notas"
        subtitle="Notas fiscais vinculadas e avulsas"
        actions={
        <button
          type="button"
          onClick={() => setShowStandaloneForm(true)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Lançar nota avulsa
        </button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg bg-slate-100 p-1">
          {([
            ["pending", "Pendentes"],
            ["completed", "Concluídas"],
            ["all", "Todas"],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => updateParams({ status: value, page: 1 })}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                status === value
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          data-page-search
          value={search}
          onChange={(event) => updateParams({ q: event.target.value, page: 1 })}
          placeholder="Buscar fornecedor ou Nº da nota"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:max-w-xs"
        />
      </div>

      <div className="invoice-notes-card relative min-h-80 overflow-hidden rounded-2xl bg-white shadow-sm">
        {loading ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-slate-500">
            Carregando...
          </div>
        ) : error ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-2 text-sm text-red-600">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="text-blue-600 underline">
              Tentar novamente
            </button>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-slate-400">
            {emptyMessage(status)}
          </div>
        ) : (
          <div className="invoice-notes-list">
            <div className="invoice-notes-header hidden grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto_auto] gap-5 bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-500 sm:grid">
              <span>Fornecedor</span>
              <span>Nº da Nota</span>
              <span>Data de emissão</span>
              <span>Valor total</span>
              <span>Pedido</span>
              <span className="w-20 text-right">Status</span>
            </div>
            {notes.map((note) => (
              <div
                key={note.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/notas/${note.id}?${params.toString()}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/notas/${note.id}?${params.toString()}`);
                }}
                className={`invoice-note-row grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 transition ${
                  note.nota_conferida ? "is-completed text-slate-400" : "text-slate-800"
                }`}
              >
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] sm:items-center sm:gap-5">
                  <p className="invoice-note-supplier truncate text-sm font-semibold">{note.supplier_name}</p>
                  <p className="invoice-note-number text-xs font-mono">Nota {note.nota_numero}</p>
                  <p className="invoice-note-date text-xs font-mono">{formatDateOnly(note.issued_on)}</p>
                  <p className="invoice-note-value text-xs font-mono">
                    {note.total == null ? "-" : formatCurrency(note.total)}
                  </p>
                  <p className="text-xs font-bold text-blue-700">
                    {note.order_number == null ? "Avulsa" : `#${note.order_number}`}
                  </p>
                </div>
                <label
                  className="invoice-note-status flex items-center gap-2 text-xs font-medium"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="hidden sm:inline">Concluído</span>
                  <input
                    type="checkbox"
                    checked={note.nota_conferida}
                    onChange={(event) => void toggle(note, event.target.checked)}
                    className="invoice-note-checkbox h-5 w-5"
                    aria-label={`Concluir nota ${note.nota_numero}`}
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-xs text-slate-500">Mostrando {start}–{end} de {total} notas</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page === 1 || loading}
            onClick={() => updateParams({ page: page - 1 })}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-40"
          >
            Anterior
          </button>
          {visiblePages(page, totalPages).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => updateParams({ page: item })}
              aria-current={item === page ? "page" : undefined}
              className={`h-8 w-8 rounded-lg text-xs font-semibold ${
                item === page ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            disabled={page === totalPages || loading}
            onClick={() => updateParams({ page: page + 1 })}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-40"
          >
            Próximo
          </button>
        </div>
      </div>

      {undo && (
        <div className="fixed bottom-5 right-5 z-[90] rounded-xl border border-green-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-xl">
          Nota conferida ·{" "}
          <button
            type="button"
            className="font-semibold text-blue-600 hover:underline"
            onClick={async () => {
              await notesApi.setChecked(undo.id, undo.checked, undo.noteType);
              setUndo(null);
              window.dispatchEvent(new Event("tecar:notes-changed"));
              await load();
            }}
          >
            Desfazer
          </button>
        </div>
      )}
      {showStandaloneForm && (
        <StandaloneInvoiceModal
          onClose={() => setShowStandaloneForm(false)}
          onSaved={() => {
            setShowStandaloneForm(false);
            updateParams({ status: "pending", page: 1 });
            void load();
          }}
        />
      )}
    </div>
  );
}

export function InvoiceNoteDetails({
  orderId,
  onViewOrder,
}: {
  orderId: string;
  onViewOrder: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const listUrl = `/notas${location.search}`;

  useEffect(() => {
    notesApi
      .getStandalone(orderId)
      .then((standalone) => standalone ?? ordersApi.get(orderId))
      .then((result) => setOrder({
        ...result,
        note_type: result.note_type ?? "order",
      }))
      .catch(() => setError("Nota não encontrada."))
      .finally(() => setLoading(false));
  }, [orderId]);

  const toggle = async () => {
    try {
      const result = await notesApi.setChecked(
        order.id,
        !order.nota_conferida,
        order.note_type,
      );
      setOrder((current: any) => ({ ...current, ...result }));
      window.dispatchEvent(new Event("tecar:notes-changed"));
    } catch (caught: any) {
      setError("Não foi possível alterar a conferência.");
    }
  };

  if (loading) {
    return <div className="flex h-48 items-center justify-center text-sm text-slate-400">Carregando nota...</div>;
  }
  if (!order || error) {
    return <div className="flex h-48 items-center justify-center text-sm text-red-500">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader
        onBack={() => navigate(listUrl)}
        title={`Nota ${order.nota_numero || "sem número"}`}
        subtitle={order.note_type === "standalone" ? "Nota fiscal avulsa" : `Pedido #${order.order_number}`}
        actions={order.note_type === "order" ? (
          <button type="button" onClick={onViewOrder} className="text-sm font-semibold text-blue-600 hover:underline">
            Ver pedido
          </button>
        ) : undefined}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 border-b border-slate-100 pb-5 md:grid-cols-3">
          <div className="md:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fornecedor</p>
            <p className="font-semibold text-slate-900">{order.supplier_name}</p>
            <p className="mt-0.5 text-xs font-mono text-slate-500">{order.supplier_cnpj}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {order.note_type === "standalone" ? "Tipo" : "Pedido Nº"}
            </p>
            <p className="font-bold text-blue-700">
              {order.note_type === "standalone" ? "Avulsa" : `#${order.order_number}`}
            </p>
          </div>
          {order.note_type === "order" ? (
            <InvoiceNumberEditor
              orderId={order.id}
              initialNumber={order.nota_numero}
              onSaved={(result) => {
                if (!result.nota_numero) {
                  navigate(listUrl);
                  return;
                }
                setOrder((current: any) => ({ ...current, ...result }));
              }}
            />
          ) : (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Nº da Nota</p>
              <p className="text-sm font-semibold text-slate-700">{order.nota_numero}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Data de emissão</p>
            <p className="text-sm text-slate-700">
              {order.note_type === "standalone"
                ? formatDateOnly(order.issued_on)
                : order.issued_at
                  ? formatDate(order.issued_at)
                  : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Feito por</p>
            <p className="text-sm text-slate-700">
              {order.created_by_name || "Não identificado"}
            </p>
          </div>
        </div>

        {order.note_type === "order" && (
        <div className="mt-5 overflow-x-auto">
          <table className="order-items-table w-full text-xs">
            <thead>
              <tr className="table-header text-slate-300">
                {["Qtde", "Un", "Código/Desenho", "Descrição", "Vl Unit", "Desc", "Acrés", "IPI", "Total"].map((label) => (
                  <th key={label} className="px-3 py-2.5 text-left font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item: any, index: number) => (
                <tr key={item.id ?? index} className={index % 2 ? "bg-slate-50" : "bg-white"}>
                  <td className="px-3 py-2 text-center font-mono">{item.qty}</td>
                  <td className="px-3 py-2 text-center">{item.unit || "UN"}</td>
                  <td className="px-3 py-2 font-mono">{item.code || "—"}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.discount ? formatCurrency(item.discount) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.addition ? formatCurrency(item.addition) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.ipi ? `${item.ipi}%` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100">
                <td colSpan={8} className="px-3 py-3 text-right font-bold">TOTAL GERAL</td>
                <td className="px-3 py-3 text-right font-mono font-bold">{formatCurrency(order.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        )}

        {order.note_type === "standalone" && (
          <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Valor total</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {order.total == null ? "-" : formatCurrency(Number(order.total))}
            </p>
          </div>
        )}

        {order.note_type === "order" && order.notes && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-700">
            <span className="font-semibold text-amber-700">Observações: </span>{order.notes}
          </div>
        )}

        <div className="mt-6 flex flex-col items-start justify-between gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center">
          <p className={`text-sm font-semibold ${order.nota_conferida ? "text-green-700" : "text-amber-700"}`}>
            {order.nota_conferida
              ? `Concluída por ${order.nota_conferida_por} em ${formatDateTime(order.nota_conferida_em)}`
              : "Pendente"}
          </p>
          <button
            type="button"
            onClick={() => void toggle()}
            className={`rounded-xl px-5 py-3 text-sm font-bold text-white ${
              order.nota_conferida ? "bg-slate-700 hover:bg-slate-800" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {order.nota_conferida ? "Reabrir conferência" : "Marcar como concluída"}
          </button>
        </div>
      </div>
    </div>
  );
}
