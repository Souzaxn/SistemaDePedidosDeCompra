import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { suppliersApi, ordersApi, itemsApi, draftsApi, notesApi } from "../lib/api";
import { InventoryItem, normalizeItemCode, StockItem } from "../lib/items";
import { formatCurrency, formatDate } from "../lib/format";
import { formatCNPJ } from "../lib/cnpj";
import { downloadOrderPDF, OrderItem, printOrderPDF } from "../lib/pdf";
import SupplierModal from "./SupplierModal";
import PageHeader from "./PageHeader";

interface Supplier {
  id: string;
  name: string;
  cnpj: string;
}

interface Props {
  editId?: string | null;
  duplicateId?: string | null;
  onSaved?: (notice?: string) => void;
  onBack: () => void;
}

const newItem = (): OrderItem => ({
  id: Math.random().toString(36).slice(2),
  qty: 1,
  unit: "UN",
  code: "",
  description: "",
  unit_price: 0,
  discount: 0,
  addition: 0,
  ipi: 0,
  total: 0,
});

const calcItem = (item: OrderItem): OrderItem => {
  const base = item.qty * item.unit_price;
  const ipiAmt = base * (item.ipi / 100);
  const total = base - item.discount + item.addition + ipiAmt;
  return { ...item, total: Math.max(0, total) };
};

export default function OrderForm({ editId, duplicateId, onSaved, onBack }: Props) {
  const { profile, user } = useAuth();
  const [items, setItems] = useState<OrderItem[]>([newItem()]);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierSuggestions, setSupplierSuggestions] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [notes, setNotes] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [initialInvoiceNumber, setInitialInvoiceNumber] = useState("");
  const [invoiceTouched, setInvoiceTouched] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ payload: Record<string, any>; updated_at: string } | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [draftReady, setDraftReady] = useState(Boolean(editId || duplicateId));
  const [orderData, setOrderData] = useState<any>(null);
  const [emittedOrder, setEmittedOrder] = useState<any>(null);
  const [emittedNotice, setEmittedNotice] = useState("");
  const [printing, setPrinting] = useState(false);
  const [sourceOrderNumber, setSourceOrderNumber] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [confirmEmit, setConfirmEmit] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const itemSearchTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editId) loadOrder();
  }, [editId]);

  useEffect(() => {
    if (!duplicateId) return;
    ordersApi.get(duplicateId)
      .then((order) => {
        setSourceOrderNumber(order.order_number);
        setSupplierQuery(order.supplier_name);
        setCnpj(order.supplier_cnpj);
        setSelectedSupplier({
          id: order.supplier_id || "",
          name: order.supplier_name,
          cnpj: order.supplier_cnpj,
        });
        setItems(order.items?.length
          ? order.items.map((item: OrderItem) => ({ ...item, id: Math.random().toString(36).slice(2) }))
          : [newItem()]);
        setNotes(order.notes || "");
        setInvoiceNumber("");
        setInitialInvoiceNumber("");
        setInvoiceTouched(false);
        setDirty(false);
      })
      .catch(() => setError("Erro ao carregar o pedido para duplicação."));
  }, [duplicateId]);

  useEffect(() => {
    if (editId || duplicateId) return;
    draftsApi.getMine()
      .then(setDraft)
      .catch(() => setDraft(null))
      .finally(() => setDraftReady(true));
  }, [editId, duplicateId]);

  useEffect(() => {
    const addStockItem = (event: Event) => {
      const stock = (event as CustomEvent<StockItem>).detail;
      if (!stock) return;
      setItems((current) => {
        const existing = current.findIndex(
          (item) => normalizeItemCode(item.code) === normalizeItemCode(stock.codigo),
        );
        if (existing >= 0) {
          return current.map((item, index) =>
            index === existing ? calcItem({ ...item, qty: item.qty + 1 }) : item,
          );
        }
        const empty = current.findIndex((item) =>
          !item.code.trim() &&
          !item.description.trim() &&
          item.unit_price === 0 &&
          item.discount === 0 &&
          item.addition === 0 &&
          item.ipi === 0,
        );
        const added = calcItem({
          ...newItem(),
          code: stock.codigo,
          description: stock.descricao,
          unit_price: stock.custo_fornecedor,
        });
        if (empty >= 0) return current.map((item, index) => index === empty ? added : item);
        return [...current, added];
      });
      setDirty(true);
    };
    window.addEventListener("tecar:add-stock-item", addStockItem);
    return () => window.removeEventListener("tecar:add-stock-item", addStockItem);
  }, []);

  useEffect(() => {
    if (editId || duplicateId || !draftReady || !dirty) return;
    const hasData =
      supplierQuery.trim() ||
      cnpj.trim() ||
      notes.trim() ||
      invoiceNumber.trim() ||
      items.some((item) => item.code.trim() || item.description.trim() || item.unit_price);
    if (!hasData) return;
    const timer = window.setTimeout(async () => {
      try {
        const saved = await draftsApi.saveMine({
          supplierQuery,
          selectedSupplier,
          cnpj,
          items,
          notes,
          invoiceNumber,
        });
        setDraftSavedAt(saved.updated_at);
        setDirty(false);
      } catch {
        // O pedido permanece editável e uma nova alteração tentará salvar novamente.
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [editId, duplicateId, draftReady, dirty, supplierQuery, selectedSupplier, cnpj, items, notes, invoiceNumber]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const loadOrder = async () => {
    try {
      const o = await ordersApi.get(editId!);
      setOrderData(o);
      setSupplierQuery(o.supplier_name);
      setCnpj(o.supplier_cnpj);
      setSelectedSupplier({ id: o.supplier_id || "", name: o.supplier_name, cnpj: o.supplier_cnpj });
      setItems(o.items.length ? o.items : [newItem()]);
      setNotes(o.notes || "");
      setInvoiceNumber(o.nota_numero || "");
      setInitialInvoiceNumber(o.nota_numero || "");
      setInvoiceTouched(false);
    } catch {
      setError("Erro ao carregar pedido.");
    }
  };

  const searchSuppliers = useCallback(async (q: string) => {
    if (!q.trim()) { setSupplierSuggestions([]); return; }
    try {
      const data = await suppliersApi.list(q);
      setSupplierSuggestions(data);
    } catch {
      // ignore
    }
  }, []);

  const handleSupplierInput = (v: string) => {
    setSupplierQuery(v);
    setSelectedSupplier(null);
    setCnpj("");
    setShowSuggestions(true);
    setDirty(true);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchSuppliers(v), 250);
  };

  const selectSupplier = (s: Supplier) => {
    setSelectedSupplier(s);
    setSupplierQuery(s.name);
    setCnpj(s.cnpj);
    setShowSuggestions(false);
    setSupplierSuggestions([]);
    setDirty(true);
  };

  const handleSupplierSaved = (s: Supplier) => {
    selectSupplier(s);
    setShowSupplierModal(false);
    setEditingSupplier(null);
  };

  const updateItem = (id: string, field: keyof OrderItem, value: string | number) => {
    setDirty(true);
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        return calcItem(updated);
      }),
    );
  };

  const lookupItem = (id: string, rawCode: string) => {
    updateItem(id, "code", rawCode);
    clearTimeout(itemSearchTimeouts.current[id]);
    const codigo = normalizeItemCode(rawCode);
    if (!codigo) return;

    itemSearchTimeouts.current[id] = setTimeout(async () => {
      try {
        const inventoryItem = await itemsApi.findByCode(codigo);
        if (!inventoryItem) return;
        setItems((current) =>
          current.map((item) => {
            if (
              item.id !== id ||
              normalizeItemCode(item.code) !== inventoryItem.codigo
            ) {
              return item;
            }
            return calcItem({
              ...item,
              code: inventoryItem.codigo,
              description: inventoryItem.descricao,
              unit_price: inventoryItem.valor,
            });
          }),
        );
      } catch {
        // A busca não deve impedir o preenchimento manual do item.
      }
    }, 300);
  };

  const focusItemField = (id: string, field: string) => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(
        `[data-item-id="${id}"][data-item-field="${field}"]`,
      )?.focus();
    });
  };
  const addItem = (focus = false, empty = false) => {
    const item = empty ? { ...newItem(), qty: 0, unit: "" } : newItem();
    setDirty(true);
    setItems((prev) => [...prev, item]);
    if (focus) focusItemField(item.id, "qty");
  };
  const removeItem = (id: string) => { setDirty(true); setItems((prev) => prev.filter((i) => i.id !== id)); };

  const total = items.reduce((sum, i) => sum + i.total, 0);

  const handleSave = async (confirmedDuplicate = false) => {
    setError("");
    setInvoiceError("");
    const trimmedInvoice = invoiceNumber.trim();
    const requiresInvoice =
      !editId || Boolean(initialInvoiceNumber.trim()) || invoiceTouched;
    if (requiresInvoice && !trimmedInvoice) {
      setInvoiceError("Informe o número da nota");
      window.requestAnimationFrame(() => {
        invoiceInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        invoiceInputRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    if (!supplierQuery.trim()) { setError("Informe o fornecedor."); return; }
    if (!cnpj.trim()) { setError("Informe o CNPJ."); return; }
    const validItems = items.filter((i) => i.description.trim());
    if (!validItems.length) { setError("Adicione pelo menos um item com descrição."); return; }
    if (trimmedInvoice && !confirmedDuplicate) {
      try {
        const duplicate = await notesApi.findDuplicate(
          trimmedInvoice,
          { id: selectedSupplier?.id, cnpj },
          editId || undefined,
        );
        if (duplicate) {
          setDuplicateWarning(duplicate.order_number);
          return;
        }
      } catch (err: any) {
        setError("Erro ao verificar o Nº da Nota.");
        return;
      }
    }

    setSaving(true);
    const payload = {
      supplier_id: selectedSupplier?.id || undefined,
      supplier_name: supplierQuery.trim(),
      supplier_cnpj: cnpj,
      items,
      total,
      notes,
      nota_numero: trimmedInvoice,
    };

    try {
      let savedOrder: any;
      if (editId) {
        savedOrder = await ordersApi.update(editId, {
          ...payload,
          update_note: invoiceTouched,
        });
      } else {
        savedOrder = await ordersApi.create(payload);
        if (!duplicateId) await draftsApi.deleteMine().catch(() => undefined);
      }
      window.dispatchEvent(new Event("tecar:notes-changed"));

      let itemWarning = "";
      const inventoryItems = new Map<string, InventoryItem>();
      for (const item of validItems) {
        const codigo = normalizeItemCode(item.code);
        if (!codigo) continue;
        inventoryItems.set(codigo, {
          codigo,
          descricao: item.description.trim(),
          valor: Math.round(item.unit_price * 100) / 100,
        });
      }
      try {
        await itemsApi.insertMissing([...inventoryItems.values()]);
      } catch {
        itemWarning = "Pedido emitido, mas alguns itens novos não foram salvos";
      }
      setDirty(false);
      if (editId) {
        onSaved?.(itemWarning || undefined);
      } else {
        setEmittedOrder(savedOrder);
        setEmittedNotice(itemWarning);
        setSaving(false);
      }
    } catch (err: any) {
      setError("Erro ao salvar pedido.");
      setSaving(false);
    }
  };

  const itemFields = ["qty", "unit", "code", "description", "unit_price", "discount", "addition", "ipi"];
  const handleItemEnter = (event: React.KeyboardEvent<HTMLInputElement>, itemId: string, field: string) => {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const rowIndex = items.findIndex((item) => item.id === itemId);
    const fieldIndex = itemFields.indexOf(field);
    if (fieldIndex < itemFields.length - 1) {
      focusItemField(itemId, itemFields[fieldIndex + 1]);
    } else if (rowIndex < items.length - 1) {
      focusItemField(items[rowIndex + 1].id, "qty");
    } else {
      addItem(true, true);
    }
  };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        addItem(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (editId) void handleSave();
        else setConfirmEmit(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        setShowShortcuts(true);
        return;
      }
      if (event.key === "Escape") {
        if (emittedOrder) {
          onSaved?.(emittedNotice || undefined);
          return;
        }
        setShowShortcuts(false);
        setConfirmEmit(false);
        setDuplicateWarning(null);
      }
      if (confirmEmit && event.key === "Enter") {
        event.preventDefault();
        setConfirmEmit(false);
        void handleSave();
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });

  const handlePDF = () => {
    const data = orderData
      ? { ...orderData, items, total, supplier_name: supplierQuery, supplier_cnpj: cnpj, notes }
      : {
          order_number: 0,
          supplier_name: supplierQuery,
          supplier_cnpj: cnpj,
          issued_at: new Date().toISOString(),
          items,
          total,
          notes,
          created_by_name: profile?.name?.trim() || user?.email || "Não identificado",
        };
    downloadOrderPDF(data);
  };

  const numInput = (id: string, field: keyof OrderItem, val: number, placeholder = "0") => (
    <input
      type="number"
      min="0"
      step="0.01"
      value={val || ""}
      placeholder={placeholder}
      onChange={(e) => updateItem(id, field, parseFloat(e.target.value) || 0)}
      onKeyDown={(event) => handleItemEnter(event, id, field)}
      data-item-id={id}
      data-item-field={field}
      className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {sourceOrderNumber !== null && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Pedido duplicado a partir do #{sourceOrderNumber}. Revise os dados antes de emitir.
        </div>
      )}
      {!editId && draft && (
        <div className="draft-notice mb-4 flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="draft-notice-copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M9 13h6m-6 4h4" />
            </svg>
            <span>
              Você tem um rascunho não finalizado de {formatDate(draft.updated_at)} às{" "}
              <strong>{new Date(draft.updated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</strong>
            </span>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const payload = draft.payload;
                setSupplierQuery(payload.supplierQuery ?? "");
                setSelectedSupplier(payload.selectedSupplier ?? null);
                setCnpj(payload.cnpj ?? "");
                setItems(payload.items?.length ? payload.items : [newItem()]);
                setNotes(payload.notes ?? "");
                setInvoiceNumber(payload.invoiceNumber ?? "");
                setDraft(null);
                setDirty(false);
              }}
              className="draft-continue rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer"
            >
              Continuar
            </button>
            <button
              type="button"
              onClick={() => void draftsApi.deleteMine().then(() => setDraft(null))}
              className="draft-discard rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
      <PageHeader
        onBack={onBack}
        title={editId ? `Editar Pedido #${orderData?.order_number ?? ""}` : "Novo Pedido de Compra"}
        actions={
          <>
          {!editId && draftSavedAt && (
            <span className="hidden text-xs text-slate-500 sm:inline">
              Rascunho salvo às {new Date(draftSavedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
            </span>
          )}
          {editId && (
            <button
              onClick={handlePDF}
              className="flex items-center gap-1.5 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              PDF
            </button>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            title={editId ? "Salvar alterações (Ctrl+S)" : "Emitir pedido (Ctrl+S)"}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg px-5 py-2 text-sm transition cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? "Salvando..." : editId ? "Salvar Alterações" : "Emitir Pedido"}
          </button>
          </>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="order-brand-header px-6 py-4 text-center">
          <p className="text-blue-400 text-xs font-mono tracking-wider">02 - TECAR FIAT BSB W3</p>
          <p className="text-slate-300 text-xs mt-0.5">SEP/N QUADRA 512 CONJUNTO C · Brasília-DF · Cep 70760500</p>
          <p className="text-slate-400 text-xs">(61) 2196-2900 · CGC 07.757.357/0001-68</p>
        </div>
        <div className="bg-blue-600 px-6 py-2 text-center">
          <span className="text-white font-bold text-sm tracking-wide">
            PEDIDO DE COMPRA{orderData?.order_number ? ` — Nº ${orderData.order_number}` : ""}
          </span>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 relative">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Fornecedor</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    value={supplierQuery}
                    onChange={(e) => handleSupplierInput(e.target.value)}
                    onFocus={() => supplierQuery && setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder="Digite para buscar ou cadastrar..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {showSuggestions && supplierSuggestions.length > 0 && (
                    <div className="supplier-suggestions absolute top-full left-0 right-0 z-20 mt-1 overflow-hidden">
                      {supplierSuggestions.map((s) => (
                        <div
                          key={s.id}
                          onMouseDown={() => selectSupplier(s)}
                          className="supplier-suggestion flex cursor-pointer items-center justify-between px-4 py-3 text-sm"
                        >
                          <span className="font-medium text-slate-800">{s.name}</span>
                          <span className="text-slate-400 text-xs font-mono">{s.cnpj}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setEditingSupplier(null); setShowSupplierModal(true); }}
                  title="Cadastrar novo fornecedor"
                  className="border border-slate-200 hover:border-blue-300 hover:bg-blue-50 rounded-lg px-3 py-2.5 text-slate-500 hover:text-blue-600 cursor-pointer transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                {selectedSupplier && (
                  <button
                    onClick={() => { setEditingSupplier(selectedSupplier); setShowSupplierModal(true); }}
                    title="Editar fornecedor"
                    className="border border-slate-200 hover:border-amber-300 hover:bg-amber-50 rounded-lg px-3 py-2.5 text-slate-500 hover:text-amber-600 cursor-pointer transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">CNPJ</label>
              <input
                value={cnpj}
                onChange={(e) => { setCnpj(formatCNPJ(e.target.value)); setDirty(true); }}
                readOnly={!!selectedSupplier}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 read-only:bg-slate-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Data de Emissão
              </label>
              <input
                value={orderData?.issued_at ? formatDate(orderData.issued_at) : formatDate(new Date().toISOString())}
                readOnly
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm text-slate-800 read-only:bg-slate-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nº da Nota{" "}
                <span className="text-red-600">*</span>
              </label>
              <input
                ref={invoiceInputRef}
                value={invoiceNumber}
                onChange={(event) => {
                  setInvoiceNumber(event.target.value.slice(0, 20));
                  setInvoiceTouched(true);
                  if (event.target.value.trim()) setInvoiceError("");
                  setDirty(true);
                }}
                onBlur={() => setInvoiceNumber((current) => current.trim())}
                maxLength={20}
                placeholder="Ex.: 123456"
                aria-invalid={Boolean(invoiceError)}
                aria-describedby={invoiceError ? "invoice-number-error" : undefined}
                className={`w-full rounded-lg border px-3 py-2.5 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 ${
                  invoiceError
                    ? "border-red-500 focus:ring-red-400"
                    : "border-slate-200 focus:ring-blue-500"
                }`}
              />
              {invoiceError && (
                <p id="invoice-number-error" className="mt-1 text-xs text-red-600">
                  {invoiceError}
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Itens do Pedido</label>
              <button
                onClick={() => addItem()}
                title="Adicionar item (Ctrl+Enter)"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Adicionar Item
              </button>
            </div>
            <div className="order-items-wrap border border-slate-200 rounded-xl overflow-x-auto">
              <table className="order-items-table w-full text-xs">
                <thead>
                  <tr className="table-header text-slate-300">
                    <th className="px-2 py-2 text-center font-medium w-14">Qtde</th>
                    <th className="px-2 py-2 text-center font-medium w-14">Un</th>
                    <th className="px-2 py-2 text-left font-medium w-28">Cód/Desenho</th>
                    <th className="px-2 py-2 text-left font-medium">Descrição</th>
                    <th className="px-2 py-2 text-right font-medium w-24">Vl Unitário</th>
                    <th className="px-2 py-2 text-right font-medium w-20">Desc R$</th>
                    <th className="px-2 py-2 text-right font-medium w-20">Acrés R$</th>
                    <th className="px-2 py-2 text-right font-medium w-16">IPI %</th>
                    <th className="px-2 py-2 text-right font-medium w-24">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-2 py-1.5">{numInput(item.id, "qty", item.qty, "1")}</td>
                      <td className="px-2 py-1.5">
                        <input
                          value={item.unit}
                          onChange={(e) => updateItem(item.id, "unit", e.target.value.toUpperCase())}
                          onKeyDown={(event) => handleItemEnter(event, item.id, "unit")}
                          data-item-id={item.id}
                          data-item-field="unit"
                          className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs text-center uppercase focus:outline-none focus:ring-1 focus:ring-blue-400"
                          maxLength={4}
                          placeholder="UN"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={item.code}
                          onChange={(e) => lookupItem(item.id, e.target.value)}
                          onKeyDown={(event) => handleItemEnter(event, item.id, "code")}
                          data-item-id={item.id}
                          data-item-field="code"
                          className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="ABC-123"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={item.description}
                          onChange={(e) => updateItem(item.id, "description", e.target.value)}
                          onKeyDown={(event) => handleItemEnter(event, item.id, "description")}
                          data-item-id={item.id}
                          data-item-field="description"
                          className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="Descrição do produto..."
                        />
                      </td>
                      <td className="px-2 py-1.5">{numInput(item.id, "unit_price", item.unit_price)}</td>
                      <td className="px-2 py-1.5">{numInput(item.id, "discount", item.discount)}</td>
                      <td className="px-2 py-1.5">{numInput(item.id, "addition", item.addition)}</td>
                      <td className="px-2 py-1.5">{numInput(item.id, "ipi", item.ipi)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="font-mono font-semibold text-slate-800">{formatCurrency(item.total)}</span>
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        {items.length > 1 && (
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-slate-300 hover:text-red-500 cursor-pointer transition"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-200">
                    <td colSpan={8} className="px-4 py-2.5 text-right text-xs font-bold text-slate-700 uppercase tracking-wide">Total Geral:</td>
                    <td className="px-2 py-2.5 text-right font-mono font-bold text-slate-900 text-sm">{formatCurrency(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              rows={2}
              placeholder="Informações adicionais..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="border-t border-slate-200 pt-3 text-xs text-slate-400 flex flex-wrap justify-between gap-3">
            <span>
              Feito por:{" "}
              <span className="font-medium text-slate-600">
                {orderData?.created_by_name || profile?.name?.trim() || user?.email || "Não identificado"}
              </span>
            </span>
            <button type="button" onClick={() => setShowShortcuts(true)} className="hover:text-blue-600">
              Atalhos (Ctrl+/)
            </button>
            {!editId && <span className="italic">Número e data gerados ao emitir</span>}
          </div>
        </div>
      </div>

      {showSupplierModal && (
        <SupplierModal
          onClose={() => { setShowSupplierModal(false); setEditingSupplier(null); }}
          onSaved={handleSupplierSaved}
          initial={editingSupplier}
        />
      )}
      {duplicateWarning !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-bold text-slate-800">Nota já cadastrada</h2>
            <p className="mt-2 text-sm text-slate-600">
              Já existe a nota {invoiceNumber.trim()} deste fornecedor no pedido #{duplicateWarning}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Uma nota pode cobrir mais de um pedido. Deseja continuar?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDuplicateWarning(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicateWarning(null);
                  void handleSave(true);
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmEmit && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-bold text-slate-800">Emitir o pedido?</h2>
            <p className="mt-2 text-sm text-slate-500">Pressione Enter para confirmar ou Esc para cancelar.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setConfirmEmit(false)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm">Cancelar</button>
              <button type="button" onClick={() => { setConfirmEmit(false); void handleSave(); }} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white">Emitir</button>
            </div>
          </div>
        </div>
      )}
      {showShortcuts && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 id="shortcuts-title" className="text-lg font-bold text-slate-800">Atalhos de teclado</h2>
              <button type="button" onClick={() => setShowShortcuts(false)} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">×</button>
            </div>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="font-mono font-semibold text-slate-700">Enter</dt><dd className="text-slate-500">Próximo campo do item</dd>
              <dt className="font-mono font-semibold text-slate-700">Ctrl+Enter</dt><dd className="text-slate-500">Adicionar nova linha</dd>
              <dt className="font-mono font-semibold text-slate-700">F2</dt><dd className="text-slate-500">Abrir ou fechar a consulta de estoque</dd>
              <dt className="font-mono font-semibold text-slate-700">↑ / ↓ + Enter</dt><dd className="text-slate-500">Selecionar e adicionar item do estoque</dd>
              <dt className="font-mono font-semibold text-slate-700">Ctrl+S</dt><dd className="text-slate-500">{editId ? "Salvar edição" : "Emitir pedido"}</dd>
              <dt className="font-mono font-semibold text-slate-700">Ctrl+/</dt><dd className="text-slate-500">Mostrar estes atalhos</dd>
              <dt className="font-mono font-semibold text-slate-700">Esc</dt><dd className="text-slate-500">Fechar janelas e painéis</dd>
            </dl>
          </div>
        </div>
      )}
      {emittedOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-50 text-green-600">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m5 12 4 4L19 6" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-bold text-slate-800">
              Pedido Nº {emittedOrder.order_number} emitido
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              O pedido foi salvo e está disponível no histórico.
            </p>
            {emittedNotice && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {emittedNotice}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={printing}
                onClick={async () => {
                  setPrinting(true);
                  try {
                    await printOrderPDF(emittedOrder);
                  } catch (error: any) {
                    alert("Não foi possível abrir a impressão.");
                  } finally {
                    setPrinting(false);
                  }
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12-4h12v7H6v-7Z" />
                </svg>
                {printing ? "Preparando impressão..." : "Imprimir"}
              </button>
              <button
                type="button"
                onClick={() => downloadOrderPDF(emittedOrder)}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4" />
                </svg>
                Baixar PDF
              </button>
            </div>
            <button
              type="button"
              onClick={() => onSaved?.(emittedNotice || undefined)}
              className="mt-3 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer"
            >
              Ir para o histórico
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
