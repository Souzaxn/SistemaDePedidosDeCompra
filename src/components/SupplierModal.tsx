import { useState, useEffect, useRef } from "react";
import { suppliersApi } from "../lib/api";
import { formatCNPJ, validateCNPJ } from "../lib/cnpj";

interface Supplier {
  id: string;
  name: string;
  cnpj: string;
  phone?: string;
  email?: string;
}

interface Props {
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
  initial?: Supplier | null;
}

export default function SupplierModal({ onClose, onSaved, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [cnpj, setCnpj] = useState(initial?.cnpj ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSave = async () => {
    setError("");
    if (!name.trim()) { setError("Nome é obrigatório."); return; }
    if (!validateCNPJ(cnpj)) { setError("CNPJ inválido. Verifique os dígitos."); return; }
    setSaving(true);
    try {
      let saved: Supplier;
      if (initial?.id) {
        saved = await suppliersApi.update(initial.id, name.trim(), cnpj, phone.trim(), email.trim());
      } else {
        saved = await suppliersApi.create(name.trim(), cnpj, phone.trim(), email.trim());
      }
      onSaved(saved);
    } catch (err: any) {
      setError(err?.message || "Erro ao salvar fornecedor.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-slate-800 font-semibold text-base">
            {initial ? "Editar Fornecedor" : "Novo Fornecedor"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nome do Fornecedor *</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Razão Social"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Telefone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="(61) 00000-0000"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="contato@fornecedor.com.br"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">CNPJ *</label>
            <input
              value={cnpj}
              onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="00.000.000/0000-00"
              maxLength={18}
            />
          </div>
          {error && (
            <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 border border-slate-200 rounded-lg py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg py-2.5 text-sm transition cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
