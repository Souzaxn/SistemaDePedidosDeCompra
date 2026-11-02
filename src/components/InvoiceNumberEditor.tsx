import { useEffect, useState } from "react";
import { notesApi } from "../lib/api";

interface Props {
  orderId: string;
  initialNumber?: string | null;
  onSaved?: (result: {
    nota_numero: string | null;
    nota_conferida: boolean;
    nota_conferida_por: string | null;
    nota_conferida_em: string | null;
  }) => void;
}

export default function InvoiceNumberEditor({
  orderId,
  initialNumber,
  onSaved,
}: Props) {
  const [number, setNumber] = useState(initialNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setNumber(initialNumber ?? ""), [initialNumber]);

  const save = async () => {
    setMessage("");
    setError("");
    if (!number.trim()) {
      setError("O número da nota é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const result = await notesApi.saveNumber(orderId, number);
      if (!result) throw new Error("Pedido não encontrado.");
      setNumber(result.nota_numero ?? "");
      setMessage(
        result.duplicate_order_number
          ? `Já existe a nota ${result.nota_numero} deste fornecedor no pedido #${result.duplicate_order_number}`
          : "Nº da Nota salvo.",
      );
      onSaved?.(result);
      window.dispatchEvent(new Event("tecar:notes-changed"));
    } catch (caught: any) {
      setError("Não foi possível salvar o Nº da Nota.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Nº da Nota <span className="text-red-600">*</span>
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          value={number}
          onChange={(event) => {
            setNumber(event.target.value.slice(0, 20));
            if (event.target.value.trim()) setError("");
          }}
          onBlur={() => setNumber((current) => current.trim())}
          maxLength={20}
          placeholder="Ex.: 123456"
          aria-invalid={Boolean(error)}
          className={`w-full max-w-[200px] rounded-lg border px-3 py-2 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 ${
            error
              ? "border-red-500 focus:ring-red-400"
              : "border-slate-200 focus:ring-blue-500"
          }`}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar nota"}
        </button>
      </div>
      {message && <p className="mt-1.5 text-xs text-amber-700">{message}</p>}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
