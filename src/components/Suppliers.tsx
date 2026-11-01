import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { suppliersApi } from "../lib/api";
import SupplierModal from "./SupplierModal";
import PageHeader from "./PageHeader";

const PAGE_SIZE = 10;

interface Supplier {
  id: string;
  name: string;
  cnpj: string;
  phone?: string;
  email?: string;
  created_by?: string;
}

export default function Suppliers() {
  const { profile } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setQuery(search);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await suppliersApi.paged({ search: query, page, pageSize: PAGE_SIZE });
      setSuppliers(result.suppliers as Supplier[]);
      setTotal(result.total);
    } catch (caught: any) {
      setError(caught?.message || "Erro ao carregar fornecedores.");
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeleting(null);
        setEditing(undefined);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canDelete = (supplier: Supplier) =>
    profile?.is_admin || supplier.created_by === profile?.id;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <PageHeader
        title="Fornecedores"
        subtitle="Cadastro compartilhado de fornecedores"
        actions={
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer"
        >
          Novo fornecedor
        </button>
        }
      />
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-xs font-medium text-slate-500">Buscar por nome ou CNPJ</label>
        <input
          data-page-search
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Digite o nome ou CNPJ..."
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="relative min-h-[31rem] overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-sm text-slate-500">Carregando...</div>}
        {error ? (
          <div className="flex min-h-[31rem] items-center justify-center text-sm text-red-600">{error}</div>
        ) : (
          <table className="orders-table w-full min-w-[44rem]">
            <thead>
              <tr className="table-header text-xs text-slate-300">
                <th className="px-4 py-3 text-left font-medium">Nome</th>
                <th className="px-4 py-3 text-left font-medium">CNPJ</th>
                <th className="px-4 py-3 text-left font-medium">Telefone</th>
                <th className="px-4 py-3 text-left font-medium">E-mail</th>
                <th className="px-4 py-3 text-center font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="order-row border-t text-sm">
                  <td className="px-4 py-3 font-medium text-slate-800">{supplier.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{supplier.cnpj}</td>
                  <td className="px-4 py-3 text-slate-600">{supplier.phone || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{supplier.email || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center gap-3">
                      <button type="button" onClick={() => setEditing(supplier)} className="text-xs font-medium text-blue-600 cursor-pointer">Editar</button>
                      {canDelete(supplier) && (
                        <button type="button" onClick={() => setDeleting(supplier)} className="text-xs font-medium text-red-600 cursor-pointer">Excluir</button>
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
        <p className="text-xs text-slate-500">
          Mostrando {total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, total)} de {total} fornecedores
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-40 cursor-pointer">Anterior</button>
          <span className="px-2 py-1.5 text-xs text-slate-500">{page} / {totalPages}</span>
          <button type="button" disabled={page === totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-40 cursor-pointer">Próximo</button>
        </div>
      </div>
      {editing !== undefined && (
        <SupplierModal initial={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} />
      )}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="font-semibold text-slate-800">Excluir fornecedor?</h2>
            <p className="mt-2 text-sm text-slate-500">Esta ação não pode ser desfeita.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setDeleting(null)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm cursor-pointer">Cancelar</button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await suppliersApi.delete(deleting.id);
                    setDeleting(null);
                    await load();
                  } catch (caught: any) {
                    alert(caught?.message || "Erro ao excluir fornecedor.");
                  }
                }}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white cursor-pointer"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
