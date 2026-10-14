export const stripCNPJ = (v: string) => v.replace(/\D/g, "");

export const formatCNPJ = (v: string) => {
  const d = stripCNPJ(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
};

export const validateCNPJ = (raw: string): boolean => {
  const d = stripCNPJ(raw);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;

  const calc = (digits: string, weights: number[]) => {
    const sum = digits.split("").reduce((acc, n, i) => acc + parseInt(n) * weights[i], 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(d.slice(0, 12), w1);
  const d2 = calc(d.slice(0, 13), w2);

  return parseInt(d[12]) === d1 && parseInt(d[13]) === d2;
};
