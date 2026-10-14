import { useCallback, useEffect, useState } from "react";
import { backupsApi } from "../lib/api";
import { formatDateTime } from "../lib/format";

interface Backup {
  name: string;
  created_at: string;
  size: number;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function BackupSettings() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await backupsApi.list();
      setBackups(result.backups);
      setError(result.status?.last_error ? `Último backup falhou: ${result.status.last_error}` : "");
    } catch (caught: any) {
      setError(caught?.message || "Não foi possível consultar os backups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mt-5 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Backups</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {backups[0] ? `Último backup: ${formatDateTime(backups[0].created_at)}` : "Nenhum backup disponível"}
          </p>
        </div>
        <button
          type="button"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            try { await backupsApi.create(); await load(); }
            catch (caught: any) { setError(caught?.message || "Falha ao criar backup."); }
            finally { setWorking(false); }
          }}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
        >
          {working ? "Aguarde..." : "Fazer backup agora"}
        </button>
      </div>
      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {loading ? <p className="text-xs text-slate-500">Consultando backups...</p> : backups.map((backup) => (
          <div key={backup.name} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-700">{formatDateTime(backup.created_at)}</p>
              <p className="text-[11px] text-slate-500">{formatSize(backup.size)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={async () => {
                  try { window.location.href = await backupsApi.download(backup.name); }
                  catch (caught: any) { setError(caught?.message || "Falha ao baixar backup."); }
                }}
                className="text-xs font-medium text-blue-600 cursor-pointer"
              >
                Baixar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const date = new Date(backup.created_at).toLocaleDateString("pt-BR");
                  if (!confirm(`Isso vai substituir os dados atuais pelos do dia ${date}. Deseja continuar?`)) return;
                  setWorking(true);
                  try { await backupsApi.restore(backup.name); await load(); }
                  catch (caught: any) { setError(caught?.message || "Falha ao restaurar backup."); }
                  finally { setWorking(false); }
                }}
                className="text-xs font-medium text-amber-600 cursor-pointer"
              >
                Restaurar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
