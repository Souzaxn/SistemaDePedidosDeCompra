import { useState, useEffect } from "react";
import { ordersApi } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import { downloadOrderPDF, printOrderPDF } from "../lib/pdf";
import { useAuth } from "../contexts/AuthContext";
import InvoiceNumberEditor from "./InvoiceNumberEditor";
import PageHeader from "./PageHeader";

interface Props {
  orderId: string;
  onBack: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  canEdit: boolean;
}

export default function OrderView({ orderId, onBack, onEdit, onDuplicate, canEdit }: Props) {
  const { profile } = useAuth();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    ordersApi.get(orderId)
      .then((o) => { setOrder(o); setLoading(false); })
      .catch(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Carregando pedido...</div>;
  if (!order) return <div className="flex items-center justify-center h-48 text-red-500 text-sm">Pedido não encontrado.</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <PageHeader
        onBack={onBack}
        title={`Pedido Nº ${order.order_number}`}
        actions={
          <>
          <button
            type="button"
            onClick={onDuplicate}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 8h10a2 2 0 0 1 2 2v10H10a2 2 0 0 1-2-2V8Zm0 8H4V4h12v4" />
            </svg>
            Duplicar
          </button>
          <button
            type="button"
            disabled={printing}
            onClick={async () => {
              setPrinting(true);
              try {
                await printOrderPDF(order);
              } catch (error: any) {
                alert("Não foi possível abrir a impressão.");
              } finally {
                setPrinting(false);
              }
            }}
            className="flex items-center gap-1.5 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12-4h12v7H6v-7Z" />
            </svg>
            {printing ? "Preparando impressão..." : "Imprimir"}
          </button>
          <button
            type="button"
            onClick={() => downloadOrderPDF(order)}
            className="flex items-center gap-1.5 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Baixar PDF
          </button>
          {canEdit && (profile?.is_admin || order.created_by === profile?.id) && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Editar
            </button>
          )}
          </>
        }
      />

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="order-brand-header px-6 py-5 text-center">
          <p className="text-blue-400 text-xs font-mono tracking-wider font-semibold">02 - TECAR FIAT BSB W3</p>
          <p className="text-slate-300 text-xs mt-1">SEP/N QUADRA 512 CONJUNTO C</p>
          <p className="text-slate-300 text-xs">Brasília-DF · Cep 70760500</p>
          <p className="text-slate-400 text-xs mt-0.5">(61) 2196-2900 · CGC 07.757.357/0001-68</p>
        </div>
        <div className="bg-blue-600 px-6 py-2.5 text-center">
          <span className="text-white font-bold text-sm tracking-widest">PEDIDO DE COMPRA — Nº {order.order_number}</span>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-3 mb-6 pb-4 border-b border-slate-100">
            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Fornecedor</p>
              <p className="text-slate-900 font-semibold">{order.supplier_name}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">CNPJ</p>
              <p className="text-slate-800 font-mono">{order.supplier_cnpj}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Data de Emissão</p>
              <p className="text-slate-800">{formatDate(order.issued_at)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Feito por</p>
              <p className="text-slate-800">{order.created_by_name || "Não identificado"}</p>
            </div>
            <div className="md:col-span-2">
              <InvoiceNumberEditor
                orderId={order.id}
                initialNumber={order.nota_numero}
                onSaved={(result) =>
                  setOrder((current: any) => ({ ...current, ...result }))
                }
              />
            </div>
          </div>

          <div className="order-items-wrap overflow-x-auto">
            <table className="order-items-table w-full text-xs border border-slate-200 rounded-xl overflow-hidden">
              <thead>
                <tr className="table-header text-slate-300">
                  <th className="px-3 py-2.5 text-center font-medium">Qtde</th>
                  <th className="px-3 py-2.5 text-center font-medium">Un</th>
                  <th className="px-3 py-2.5 text-left font-medium">Código/Desenho</th>
                  <th className="px-3 py-2.5 text-left font-medium">Descrição</th>
                  <th className="px-3 py-2.5 text-right font-medium">Vl Unit</th>
                  <th className="px-3 py-2.5 text-right font-medium">Desc</th>
                  <th className="px-3 py-2.5 text-right font-medium">Acrés</th>
                  <th className="px-3 py-2.5 text-right font-medium">IPI</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item: any, idx: number) => (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-3 py-2.5 text-center font-mono">{item.qty}</td>
                    <td className="px-3 py-2.5 text-center">{item.unit || "UN"}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600">{item.code || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-800">{item.description}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatCurrency(item.unit_price)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-red-600">{item.discount ? formatCurrency(item.discount) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-green-600">{item.addition ? formatCurrency(item.addition) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{item.ipi ? item.ipi.toFixed(1) + "%" : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900">{formatCurrency(item.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300">
                  <td colSpan={8} className="px-4 py-3 text-right text-xs font-bold text-slate-700 uppercase tracking-wide">Total Geral</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-slate-900 text-sm">{formatCurrency(order.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {order.notes && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-slate-700">
              <span className="font-semibold text-amber-700">Observações: </span>{order.notes}
            </div>
          )}

          <div className="mt-6 pt-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between">
            <span>
              Feito por:{" "}
              <span className="font-medium text-slate-600">
                {order.created_by_name || "Não identificado"}
              </span>
            </span>
            <span>Emitido em: <span className="font-medium text-slate-600">{formatDate(order.issued_at)}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
