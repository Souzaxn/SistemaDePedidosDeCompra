import { useCallback, useEffect, useRef, useState } from "react";
import { stockApi } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { StockImport, StockItem } from "../lib/items";
import { STOCK_STALE_DAYS } from "../lib/stock";
import PageHeader from "./PageHeader";

const DEFAULT_PAGE_SIZE = 10;

interface Props {
  variant?: "page" | "drawer";
  onClose?: () => void;
  onBack?: () => void;
  canAddToOrder?: boolean;
}

export type StockSort = "code" | "location" | "description";

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

export default function StockSearch({ variant = "page", onClose, onBack, canAddToOrder = false }: Props) {
  const isDrawer = variant === "drawer";
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [sort, setSort] = useState<StockSort>("code");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState({ code: "", description: "", location: "" });
  const [items, setItems] = useState<StockItem[]>([]);
  const [latestImport, setLatestImport] = useState<StockImport | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addedKey, setAddedKey] = useState("");
  const requestId = useRef(0);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const resultRows = useRef<Array<HTMLTableRowElement | null>>([]);
  const lastAddAt = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setFilters({ code, description, location });
      setSelectedIndex(null);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [code, description, location]);

  useEffect(() => {
    stockApi.latestImport().then(setLatestImport).catch(() => setLatestImport(null));
  }, []);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await stockApi.list({
        code: filters.code,
        description: filters.description,
        location: filters.location,
        sort,
        direction,
        page,
        pageSize,
      });
      if (currentRequest !== requestId.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setItems(result.items);
      setSelectedIndex(null);
      setTotal(result.total);
    } catch (caught: any) {
      if (currentRequest !== requestId.current) return;
      setError("Erro ao consultar o estoque.");
      setItems([]);
      setTotal(0);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [filters, page, pageSize, sort, direction]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isDrawer || selectedIndex === null) return;
    document.querySelector(".stock-selected-row")?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, isDrawer]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const visiblePages = getVisiblePages(page, totalPages);
  const formattedTotal = new Intl.NumberFormat("pt-BR").format(total);

  const clearFilters = () => {
    setCode("");
    setDescription("");
    setLocation("");
    setSort("code");
    setDirection("asc");
    setPage(1);
    setFilters({ code: "", description: "", location: "" });
    setSelectedIndex(null);
  };

  const staleDays = latestImport
    ? Math.floor((Date.now() - new Date(latestImport.imported_at).getTime()) / 86_400_000)
    : null;
  const isStale = staleDays === null || staleDays > STOCK_STALE_DAYS;
  const freshness = (
    <div className={`flex items-start gap-1.5 text-xs ${isStale ? "text-amber-600" : "text-slate-500"}`}>
      {isStale && (
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 4h.01M10.3 3.8 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
        </svg>
      )}
      <span>
        {latestImport ? `Estoque atualizado em ${formatDate(latestImport.imported_at)}` : "Estoque ainda não importado"}
        {staleDays !== null && staleDays > STOCK_STALE_DAYS && (
          <span className="block">Atenção: há {staleDays} dias sem atualizar, os valores podem estar desatualizados</span>
        )}
      </span>
    </div>
  );

  const addToOrder = (item: StockItem) => {
    const now = Date.now();
    if (now - lastAddAt.current < 400) return false;
    lastAddAt.current = now;
    window.dispatchEvent(new CustomEvent("tecar:add-stock-item", { detail: item }));
    const key = `${item.codigo}-${item.locacao}`;
    setAddedKey(key);
    window.setTimeout(() => setAddedKey((current) => current === key ? "" : current), 1500);
    return true;
  };

  const focusResult = (index: number) => {
    setSelectedIndex(index);
    window.requestAnimationFrame(() => {
      const row = resultRows.current[index];
      if (!row) return;
      row.focus();
      if (document.activeElement !== row) {
        row.querySelector<HTMLButtonElement>("[data-stock-add]")?.focus();
      }
    });
  };

  const handleDrawerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isDrawer) return;
    const target = event.target as HTMLElement;
    const isFilter = target.matches("[data-stock-filter]");

    if (event.key === "Enter" && isFilter) {
      event.preventDefault();
      setPage(1);
      setFilters({ code, description, location });
      setSelectedIndex(null);
      return;
    }
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      !target.matches("select, button")
    ) {
      event.preventDefault();
      if (!items.length) return;
      const next = selectedIndex === null
        ? (event.key === "ArrowDown" ? 0 : items.length - 1)
        : event.key === "ArrowDown"
          ? Math.min(items.length - 1, selectedIndex + 1)
          : Math.max(0, selectedIndex - 1);
      focusResult(next);
      return;
    }
    if (
      event.key === "Enter" &&
      !event.repeat &&
      selectedIndex !== null &&
      canAddToOrder &&
      items[selectedIndex]
    ) {
      event.preventDefault();
      if (addToOrder(items[selectedIndex])) setSelectedIndex(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedIndex(null);
      onClose?.();
    }
  };

  return (
    <div
      onKeyDown={handleDrawerKeyDown}
      className={
        isDrawer
          ? "stock-search-drawer h-full min-h-0 flex flex-col overflow-hidden"
          : "max-w-6xl mx-auto px-4 py-6"
      }
    >
      {isDrawer ? (
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Consultar estoque</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Consulte códigos, locações e custos do estoque atual
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
            aria-label="Fechar consulta de estoque"
            title="Fechar"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        <PageHeader
          title="Consultar estoque"
          subtitle="Consulte códigos, locações e custos do estoque atual"
          actions={freshness}
        />
      )}

      {isDrawer && (
        <div className="shrink-0 px-4 pt-2">{freshness}</div>
      )}
      <div
        className={
          isDrawer
            ? "shrink-0 bg-white border-b border-slate-200 px-4 pb-3 pt-3"
            : "bg-white border border-slate-200 rounded-2xl p-4 mb-5 shadow-sm"
        }
      >
        <div
          className={
            isDrawer
              ? "stock-drawer-filters grid grid-cols-2 gap-2 items-end"
              : "stock-page-filters grid grid-cols-1 gap-3 items-end"
          }
        >
          <div className={isDrawer ? "" : "order-1"}>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Código
            </label>
            <input
              ref={codeInputRef}
              data-stock-code
              data-stock-filter
              data-page-search
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setSelectedIndex(null);
              }}
              placeholder={isDrawer ? "Digite o código" : "Digite parte do código..."}
              className={`${isDrawer ? "h-9 text-[13px]" : "text-sm py-2"} w-full border border-slate-200 rounded-lg px-3 font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
          <div className={isDrawer ? "" : "order-3"}>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Locação
            </label>
            <input
              data-stock-filter
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
                setSelectedIndex(null);
              }}
              placeholder="Digite a locação"
              className={`${isDrawer ? "h-9 text-[13px]" : "text-sm py-2"} w-full border border-slate-200 rounded-lg px-3 font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
          <div className={isDrawer ? "col-span-2" : "order-2"}>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Descrição
            </label>
            <input
              data-stock-filter
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setSelectedIndex(null);
              }}
              placeholder={isDrawer ? "Digite a descrição" : "Ex: para lama dian"}
              className={`${isDrawer ? "h-9 text-[13px]" : "text-sm py-2"} w-full border border-slate-200 rounded-lg px-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
          <div className={`${isDrawer ? "col-span-2" : "order-4"} flex items-end gap-2`}>
            <div className="min-w-0 flex-1">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Ordenar por</label>
              <select
                value={sort}
                onChange={(event) => { setSort(event.target.value as StockSort); setPage(1); }}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="code">Código</option>
                <option value="location">Locação</option>
                <option value="description">Ordem alfabética</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => { setDirection((current) => current === "asc" ? "desc" : "asc"); setPage(1); }}
              className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
              title={direction === "asc" ? "Crescente" : "Decrescente"}
              aria-label={direction === "asc" ? "Ordenação crescente" : "Ordenação decrescente"}
            >
              {direction === "asc" ? "↑" : "↓"}
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className={`${isDrawer ? "text-[13px]" : "text-sm"} h-9 shrink-0 border border-slate-200 rounded-lg px-4 font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition`}
            >
              Limpar
            </button>
          </div>
        </div>
      </div>

      <div
        className={
          isDrawer
            ? "relative flex-1 min-h-0 bg-white overflow-y-auto"
            : "relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden min-h-[31rem]"
        }
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-slate-500 text-sm gap-2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Carregando...
          </div>
        )}
        {error ? (
          <div className="flex flex-col items-center justify-center min-h-[31rem] text-red-500 gap-2 text-sm">
            <p>{error}</p>
            <button
              type="button"
              onClick={load}
              className="text-blue-600 text-xs underline cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        ) : items.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center min-h-[31rem] text-slate-400 gap-2">
            <svg
              className="w-10 h-10 text-slate-200"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 7h16M5 7l1 13h12l1-13M9 11v5m6-5v5M8 7l1-3h6l1 3"
              />
            </svg>
            <p className="text-sm">Nenhum item encontrado</p>
          </div>
        ) : (
          <div className="w-full">
            <table className={`orders-table w-full table-fixed ${isDrawer ? "stock-drawer-table" : "stock-page-table"}`}>
              <colgroup>
                {isDrawer ? (
                  <>
                  <col className="stock-code-column" />
                  <col />
                  <col className="stock-location-column" />
                  <col className="stock-cost-column" />
                  <col className="stock-cost-column" />
                  {canAddToOrder && <col className="stock-add-column" />}
                  </>
                ) : (
                  <>
                    <col className="stock-page-code-column" />
                    <col />
                    <col className="stock-page-location-column" />
                    <col className="stock-page-cost-column" />
                    <col className="stock-page-cost-column" />
                  </>
                )}
              </colgroup>
              <thead className={isDrawer ? "sticky top-0 z-20" : ""}>
                <tr className={`table-header text-slate-300 ${isDrawer ? "text-xs" : "text-xs"}`}>
                  <th className={`${isDrawer ? "px-2 py-2" : "px-4 py-3"} text-left font-medium`}>Código</th>
                  <th className={`${isDrawer ? "px-2 py-2" : "px-4 py-3"} text-left font-medium`}>Descrição</th>
                  <th className={`${isDrawer ? "px-2 py-2" : "px-4 py-3"} text-left font-medium`}>Locação</th>
                  <th className={`${isDrawer ? "px-1 py-2 leading-tight" : "px-4 py-3"} text-right font-medium`}>
                    Custo Contábil
                  </th>
                  <th className={`${isDrawer ? "px-1 py-2 leading-tight" : "px-4 py-3"} text-right font-medium`}>
                    Custo Fornecedor
                  </th>
                  {isDrawer && canAddToOrder && <th className="px-1 py-2"><span className="sr-only">Adicionar</span></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const rowKey = `${item.codigo}-${item.locacao}`;
                  return (
                  <tr
                    key={rowKey}
                    ref={(element) => {
                      resultRows.current[index] = element;
                    }}
                    tabIndex={isDrawer ? -1 : undefined}
                    className={`order-row border-t ${isDrawer ? "text-[13px]" : "text-sm"} ${
                      isDrawer && selectedIndex === index ? "stock-selected-row" : ""
                    }`}
                  >
                    <td className={`${isDrawer ? "px-2 py-2" : "px-4 py-3"} font-mono font-semibold text-blue-700`}>
                      {item.codigo}
                    </td>
                    <td className={`${isDrawer ? "px-2 py-0.5" : "px-4 py-3"} text-slate-800`}>
                      <span className={isDrawer ? "stock-description" : ""}>{item.descricao}</span>
                    </td>
                    <td className={`${isDrawer ? "px-2 py-2" : "px-4 py-3"} font-mono text-slate-600`}>
                      {item.locacao || "—"}
                    </td>
                    <td className={`${isDrawer ? "px-1 py-2" : "px-4 py-3"} whitespace-nowrap text-right text-slate-700`}>
                      {formatCurrency(item.custo_contabil)}
                    </td>
                    <td className={`${isDrawer ? "px-1 py-2" : "px-4 py-3"} whitespace-nowrap text-right font-semibold text-slate-900`}>
                      {formatCurrency(item.custo_fornecedor)}
                    </td>
                    {isDrawer && canAddToOrder && (
                      <td className="px-1 py-2 text-center">
                        <button
                          type="button"
                          data-stock-add
                          onClick={() => addToOrder(item)}
                          title="Adicionar ao pedido"
                          aria-label={`Adicionar ${item.codigo} ao pedido`}
                          className={`h-7 w-7 rounded-md font-bold cursor-pointer transition ${
                            addedKey === rowKey ? "bg-green-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700"
                          }`}
                        >
                          {addedKey === rowKey ? "✓" : "+"}
                        </button>
                      </td>
                    )}
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={isDrawer ? "shrink-0 border-t border-slate-200 bg-white px-4 py-3" : "mt-4 flex flex-col sm:flex-row items-center justify-between gap-3"}>
        <div className={`flex items-center gap-3 ${isDrawer ? "mb-2" : ""}`}>
          <p className={`text-xs text-slate-500 ${isDrawer ? "whitespace-nowrap" : ""}`}>
            Mostrando {rangeStart}–{rangeEnd} de {formattedTotal} itens
          </p>
          {!isDrawer && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Itens por página
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="h-8 rounded-lg border border-slate-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
          )}
        </div>
        <div className={`flex items-center gap-1 ${isDrawer ? "stock-pagination flex-nowrap" : ""}`}>
          <button
            type="button"
            disabled={page === 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className={`${isDrawer ? "h-[30px] px-2" : "px-3 py-1.5"} whitespace-nowrap border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
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
                className={`${isDrawer ? "h-[30px] w-[30px]" : "w-8 h-8"} shrink-0 rounded-lg text-xs font-semibold cursor-pointer disabled:cursor-not-allowed ${
                  item === page
                    ? "bg-blue-600 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {item}
              </button>
            ) : (
              <span key={item} className={`${isDrawer ? "w-4" : "w-6"} shrink-0 text-center text-xs text-slate-400`}>
                ...
              </span>
            ),
          )}
          <button
            type="button"
            disabled={page === totalPages || loading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className={`${isDrawer ? "h-[30px] px-2" : "px-3 py-1.5"} whitespace-nowrap border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
          >
            Próximo
          </button>
        </div>
      </div>
    </div>
  );
}
