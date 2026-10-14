export interface StandaloneInvoiceValidation {
  number?: string;
  supplier?: string;
}

export const validateStandaloneInvoice = (
  number: string,
  supplierId: string,
): StandaloneInvoiceValidation => {
  const errors: StandaloneInvoiceValidation = {};
  if (!number.trim()) errors.number = "Informe o número da nota";
  if (!supplierId) errors.supplier = "Selecione o fornecedor";
  return errors;
};
