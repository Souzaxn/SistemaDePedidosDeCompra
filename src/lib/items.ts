export interface InventoryItem {
  codigo: string;
  descricao: string;
  valor: number;
}

export interface StockItem {
  codigo: string;
  descricao: string;
  locacao: string;
  custo_contabil: number;
  custo_fornecedor: number;
}

export interface StockImport {
  id: string;
  imported_at: string;
  imported_by: string;
  imported_by_name: string;
  line_count: number;
}

const scientificToPlain = (value: string) => {
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return value;

  const [, sign, integer, fraction = "", exponentText] = match;
  const exponent = Number(exponentText);
  const digits = integer + fraction;
  const decimalPosition = integer.length + exponent;

  if (decimalPosition <= 0) {
    return `${sign === "-" ? "-" : ""}0.${"0".repeat(-decimalPosition)}${digits}`;
  }
  if (decimalPosition >= digits.length) {
    return `${sign === "-" ? "-" : ""}${digits}${"0".repeat(decimalPosition - digits.length)}`;
  }
  return `${sign === "-" ? "-" : ""}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
};

export const normalizeItemCode = (value: unknown) => {
  const plain = scientificToPlain(String(value ?? "").trim());
  return plain.replace(/\.0+$/, "");
};

export const parseInventoryValue = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }

  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma >= 0) {
    normalized = cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(",", ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};
