import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { formatDateTime } from "../lib/format";
import { backupsApi, itemsApi, stockApi } from "../lib/api";
import {
  InventoryItem,
  normalizeItemCode,
  parseInventoryValue,
  StockImport,
  StockItem,
} from "../lib/items";
import BackupSettings from "./BackupSettings";
import { STOCK_STALE_DAYS } from "../lib/stock";

interface ImportSummary {
  read: number;
  created: number;
  updated: number;
  ignored: number;
  total: number;
}

const headerName = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");

export default function InventorySettings() {
  const { profile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const backupDecisionRef = useRef<((continueImport: boolean) => void) | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchProgress, setBatchProgress] = useState("");
  const [backupWarning, setBackupWarning] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState("");
  const [latestImport, setLatestImport] = useState<StockImport | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(true);

  useEffect(() => {
    stockApi
      .latestImport()
      .then(setLatestImport)
      .catch(() => setLatestImport(null))
      .finally(() => setLoadingLatest(false));
  }, []);

  const confirmWithoutBackup = (detail: string) =>
    new Promise<boolean>((resolve) => {
      backupDecisionRef.current = resolve;
      setBackupWarning(detail);
    });

  const answerBackupWarning = (continueImport: boolean) => {
    setBackupWarning("");
    backupDecisionRef.current?.(continueImport);
    backupDecisionRef.current = null;
  };

  const importFile = async (file: File) => {
    setImporting(true);
    setProgress(2);
    setBatchProgress("Preparando backup");
    setSummary(null);
    setError("");

    try {
      try {
        await backupsApi.create("before-stock-import");
      } catch (backupError) {
        if (import.meta.env.DEV) {
          console.error("Backup before import failed", backupError);
        }
        const shouldContinue = await confirmWithoutBackup(
          "Não foi possível criar o backup automático antes da importação.",
        );
        if (!shouldContinue) {
          setProgress(0);
          return;
        }
      }

      setBatchProgress("Lendo a planilha");
      let XLSX: typeof import("xlsx");
      let workbook: import("xlsx").WorkBook;
      try {
        XLSX = await import("xlsx");
        workbook = XLSX.read(await file.arrayBuffer(), {
          type: "array",
          cellDates: false,
        });
      } catch (readError) {
        const detail = readError instanceof Error ? readError.message : String(readError);
        throw new Error(
          `Falha na leitura da planilha. Status HTTP: não aplicável. Erro retornado: ${detail}`,
        );
      }
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) {
        throw new Error(
          "Falha na leitura da planilha. Status HTTP: não aplicável. Erro retornado: a planilha não possui nenhuma aba.",
        );
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      const rowsRead = Math.max(0, rows.length - 2);
      const headers = rows[1] ?? [];
      const codeColumn = headers.findIndex(
        (header) => headerName(header) === headerName("Código do Item"),
      );
      const descriptionColumn = headers.findIndex(
        (header) => headerName(header) === headerName("Descrição"),
      );
      const valueColumn = headers.findIndex(
        (header) => headerName(header) === headerName("Custo Fornecedor"),
      );
      const locationColumn = headers.findIndex(
        (header) => headerName(header) === headerName("Locação"),
      );
      const accountingCostColumn = headers.findIndex(
        (header) => headerName(header) === headerName("Custo Contábil"),
      );

      if (
        codeColumn < 0 ||
        descriptionColumn < 0 ||
        locationColumn < 0 ||
        accountingCostColumn < 0 ||
        valueColumn < 0
      ) {
        throw new Error(
          'Falha na leitura da planilha. Status HTTP: não aplicável. Erro retornado: não encontrei os cabeçalhos "Código do Item", "Descrição", "Locação", "Custo Contábil" e "Custo Fornecedor" na linha 2.',
        );
      }

      let ignored = 0;
      const uniqueItems = new Map<string, InventoryItem>();
      const uniqueStock = new Map<string, StockItem>();

      for (const row of rows.slice(2)) {
        const codigo = normalizeItemCode(row[codeColumn]);
        if (!codigo) {
          ignored += 1;
          continue;
        }
        uniqueItems.set(codigo, {
          codigo,
          descricao: String(row[descriptionColumn] ?? "").trim(),
          valor: parseInventoryValue(row[valueColumn]),
        });
        const locacao = normalizeItemCode(row[locationColumn]);
        const stockKey = `${codigo}\u0000${locacao}`;
        if (uniqueStock.has(stockKey)) ignored += 1;
        uniqueStock.set(stockKey, {
          codigo,
          descricao: String(row[descriptionColumn] ?? "").trim(),
          locacao,
          custo_contabil: parseInventoryValue(row[accountingCostColumn]),
          custo_fornecedor: parseInventoryValue(row[valueColumn]),
        });
      }

      setProgress(10);
      const itemBatchCount = Math.ceil(uniqueItems.size / 250);
      const stockBatchCount = Math.ceil(uniqueStock.size / 250);
      const totalBatchCount = itemBatchCount + stockBatchCount;
      await itemsApi.import(
        [...uniqueItems.values()],
        (batch) => {
          setBatchProgress(`Lote ${batch} de ${totalBatchCount}`);
          setProgress(
            totalBatchCount ? 10 + Math.round((batch / totalBatchCount) * 89) : 99,
          );
        },
      );
      const result = await stockApi.import(
        [...uniqueStock.values()],
        profile?.name || "Usuário",
        (batch) => {
          const completedBatches = itemBatchCount + batch;
          setBatchProgress(`Lote ${completedBatches} de ${totalBatchCount}`);
          setProgress(
            totalBatchCount
              ? 10 + Math.round((completedBatches / totalBatchCount) * 89)
              : 99,
          );
        },
      );
      setLatestImport(result.importRecord);
      setSummary({
        read: rowsRead,
        created: result.created,
        updated: result.updated,
        ignored,
        total: result.total,
      });
      setProgress(100);
      setBatchProgress(`Lote ${totalBatchCount} de ${totalBatchCount}`);
    } catch (caught) {
      if (import.meta.env.DEV) {
        console.error("Stock import failed", caught);
      }
      setError("Não foi possível importar o estoque. Tente novamente.");
      setProgress(0);
      setBatchProgress("");
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="inventory-settings-card">
      <div className="mb-4">
        <p className="text-sm font-bold text-slate-800">Importar estoque</p>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Envie a planilha XLS ou XLSX. Serão importados código, descrição,
          locação, custo contábil e custo do fornecedor.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        disabled={importing}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <button
        type="button"
        disabled={importing}
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-60 rounded-lg px-4 py-2.5 text-xs font-semibold text-slate-600 cursor-pointer disabled:cursor-not-allowed transition"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.9A5 5 0 0115.9 6H16a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3"
          />
        </svg>
        {importing ? "Importando..." : "Selecionar planilha"}
      </button>
      <div className={`mt-2 text-[11px] leading-relaxed ${
        !latestImport || (Date.now() - new Date(latestImport.imported_at).getTime()) / 86_400_000 > STOCK_STALE_DAYS
          ? "text-amber-600"
          : "text-slate-500"
      }`}>
        {loadingLatest
          ? "Consultando última importação..."
          : latestImport
            ? (
              <>
                <p>Última importação: {formatDateTime(latestImport.imported_at)}</p>
                <p>Por {latestImport.imported_by_name} · {latestImport.line_count.toLocaleString("pt-BR")} linhas</p>
                {(Date.now() - new Date(latestImport.imported_at).getTime()) / 86_400_000 > STOCK_STALE_DAYS && (
                  <p className="mt-1">Atenção: há {Math.floor((Date.now() - new Date(latestImport.imported_at).getTime()) / 86_400_000)} dias sem atualizar, os valores podem estar desatualizados</p>
                )}
              </>
            )
            : "Estoque ainda não importado"}
      </div>

      {(importing || progress > 0) && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>
              {importing ? batchProgress || "Processando estoque" : "Importação concluída"}
            </span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div
            className="h-2 bg-slate-100 rounded-full overflow-hidden"
            role="progressbar"
            aria-label="Progresso da importação"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full bg-blue-600 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
            <p className="font-mono font-bold text-slate-800">{summary.read}</p>
            <p className="text-[10px] text-slate-500 uppercase">Linhas lidas</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
            <p className="font-mono font-bold text-slate-800">{summary.created}</p>
            <p className="text-[10px] text-slate-500 uppercase">Itens novos</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
            <p className="font-mono font-bold text-slate-800">{summary.updated}</p>
            <p className="text-[10px] text-slate-500 uppercase">Itens atualizados</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
            <p className="font-mono font-bold text-slate-800">{summary.ignored}</p>
            <p className="text-[10px] text-slate-500 uppercase">Linhas ignoradas</p>
          </div>
          <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
            <p className="font-mono font-bold text-slate-800">{summary.total}</p>
            <p className="text-[10px] text-slate-500 uppercase">Total no banco</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2.5">
          {error}
        </div>
      )}
      {backupWarning && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-warning-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <p id="backup-warning-title" className="text-sm font-bold text-slate-800">
              Não foi possível fazer o backup antes da importação. Continuar mesmo assim?
            </p>
            <p className="mt-2 break-words text-xs leading-relaxed text-slate-500">
              {backupWarning}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => answerBackupWarning(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => answerBackupWarning(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
      {profile?.is_admin && <BackupSettings />}
    </div>
  );
}
