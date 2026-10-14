import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency, formatDate } from "./format";

export interface OrderItem {
  id: string;
  qty: number;
  unit: string;
  code: string;
  description: string;
  unit_price: number;
  discount: number;
  addition: number;
  ipi: number;
  total: number;
}

export interface OrderData {
  order_number: number;
  supplier_name: string;
  supplier_cnpj: string;
  issued_at: string;
  items: OrderItem[];
  total: number;
  notes?: string;
  created_by_name: string;
}

const MARGIN = 30;
const FOOTER_LINE_Y = 810;
const CONTENT_BOTTOM = 798;
const CONTINUATION_TABLE_Y = 52;

const formatPercent = (value: number) => {
  if (!value) return "-";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;
};

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);

const drawContinuationHeader = (doc: jsPDF, orderNumber: number) => {
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`PEDIDO DE COMPRA Nº ${orderNumber} — continuação`, MARGIN, 31);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, 38, doc.internal.pageSize.getWidth() - MARGIN, 38);
};

const drawFirstPageHeader = (doc: jsPDF, order: OrderData) => {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("02 - TECAR FIAT BSB W3", pageWidth / 2, 34, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("SEP/N QUADRA 512 CONJUNTO C", pageWidth / 2, 50, { align: "center" });
  doc.text("Brasília-DF  Cep 70760500", pageWidth / 2, 63, { align: "center" });
  doc.text("(61) 2196-2900", pageWidth / 2, 76, { align: "center" });
  doc.text("CGC 07.757.357/0001-68", pageWidth / 2, 89, { align: "center" });

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 99, pageWidth - MARGIN, 99);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`PEDIDO DE COMPRA  Nº ${order.order_number}`, pageWidth / 2, 121, {
    align: "center",
  });
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 130, pageWidth - MARGIN, 130);

  doc.setFontSize(8);
  doc.text("FORNECEDOR:", MARGIN, 151);
  doc.setFont("helvetica", "normal");
  doc.text(order.supplier_name, 112, 151, { maxWidth: 274 });

  doc.setFont("helvetica", "bold");
  doc.text("CNPJ:", 399, 151);
  doc.setFont("helvetica", "normal");
  doc.text(order.supplier_cnpj, pageWidth - MARGIN, 151, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.text("DATA DE EMISSÃO:", MARGIN, 168);
  doc.setFont("helvetica", "normal");
  doc.text(formatDate(order.issued_at), 119, 168);

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 179, pageWidth - MARGIN, 179);
};

const addNotes = (doc: jsPDF, order: OrderData, startY: number) => {
  if (!order.notes?.trim()) return;

  const pageWidth = doc.internal.pageSize.getWidth();
  const textWidth = pageWidth - MARGIN * 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(order.notes.trim(), textWidth) as string[];
  let lineIndex = 0;
  let y = startY + 18;

  const startNotesPage = () => {
    doc.addPage();
    drawContinuationHeader(doc, order.order_number);
    y = CONTINUATION_TABLE_Y;
  };

  if (y + 32 > CONTENT_BOTTOM) startNotesPage();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("OBSERVAÇÕES:", MARGIN, y);
  y += 14;
  doc.setFont("helvetica", "normal");

  while (lineIndex < lines.length) {
    if (y > CONTENT_BOTTOM) {
      startNotesPage();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
    }
    doc.text(lines[lineIndex], MARGIN, y);
    lineIndex += 1;
    y += 12;
  }
};

const addFooters = (doc: jsPDF, order: OrderData, generatedAt: Date) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageCount = doc.getNumberOfPages();
  const date = generatedAt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const time = generatedAt.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, FOOTER_LINE_Y, pageWidth - MARGIN, FOOTER_LINE_Y);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text(`Feito por: ${order.created_by_name}`, MARGIN, 826);
    doc.text(`Gerado em ${date} às ${time} · Página ${page} de ${pageCount}`, pageWidth - MARGIN, 826, {
      align: "right",
    });
  }
};

export const createOrderPDF = (order: OrderData) => {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const tableWidth = pageWidth - MARGIN * 2;
  const descriptionWidth = tableWidth - 386;
  const totalQuantity = order.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const summary = `Itens: ${order.items.length} · Quantidade total: ${formatQuantity(totalQuantity)}`;

  drawFirstPageHeader(doc, order);

  const rows = order.items.map((item) => [
    formatQuantity(item.qty),
    item.unit || "UN",
    item.code,
    item.description,
    formatCurrency(item.unit_price),
    item.discount ? formatCurrency(item.discount) : "-",
    item.addition ? formatCurrency(item.addition) : "-",
    formatPercent(item.ipi),
    formatCurrency(item.total),
  ]);

  autoTable(doc, {
    startY: 190,
    margin: { top: CONTINUATION_TABLE_Y, right: MARGIN, bottom: 45, left: MARGIN },
    tableWidth,
    head: [["Qtde", "Un", "Código/Desenho", "Descrição", "Vl Unit", "Desc", "Acrés", "IPI", "Total"]],
    body: rows,
    foot: [[
      { content: "", colSpan: 8 },
      { content: formatCurrency(order.total) },
    ]],
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9,
      textColor: [0, 0, 0],
      lineColor: [185, 185, 185],
      lineWidth: 0.25,
      cellPadding: 4,
      minCellHeight: 20,
      valign: "top",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 9,
      halign: "center",
      lineColor: [0, 0, 0],
      lineWidth: 0.35,
      minCellHeight: 22,
      valign: "middle",
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
    },
    alternateRowStyles: {
      fillColor: [247, 247, 247],
    },
    footStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 9,
      lineColor: [0, 0, 0],
      lineWidth: 0.45,
      minCellHeight: 24,
      valign: "middle",
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 28 },
      1: { halign: "center", cellWidth: 24 },
      2: { halign: "left", cellWidth: 86 },
      3: { halign: "left", cellWidth: descriptionWidth },
      4: { halign: "right", cellWidth: 58 },
      5: { halign: "right", cellWidth: 46 },
      6: { halign: "right", cellWidth: 46 },
      7: { halign: "right", cellWidth: 34 },
      8: { halign: "right", cellWidth: 64 },
    },
    rowPageBreak: "avoid",
    showHead: "everyPage",
    showFoot: "lastPage",
    didParseCell: (data) => {
      if (data.section === "foot" && data.column.index === 0) {
        data.cell.styles.halign = "left";
      }
      if (data.section === "foot" && data.column.index === 8) {
        data.cell.styles.halign = "right";
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "foot" || data.column.index !== 0) return;
      const centerY = data.cell.y + data.cell.height / 2 + 3;
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(summary, data.cell.x + 4, centerY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("TOTAL GERAL", data.cell.x + data.cell.width - 4, centerY, {
        align: "right",
      });
    },
    didDrawPage: () => {
      if (doc.getNumberOfPages() > 1) {
        drawContinuationHeader(doc, order.order_number);
      }
    },
  });

  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 190;
  addNotes(doc, order, finalY);
  addFooters(doc, order, new Date());
  return doc;
};

export const getOrderPDFFileName = (order: OrderData) => {
  const supplier = order.supplier_name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "")
    .toUpperCase();
  return `Pedido-${order.order_number}-${supplier || "FORNECEDOR"}.pdf`;
};

export const downloadOrderPDF = (order: OrderData) => {
  createOrderPDF(order).save(getOrderPDFFileName(order));
};

export const printOrderPDF = async (order: OrderData, reservedWindow?: Window | null) => {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const openPrintableTab = () => {
    const fallbackDoc = createOrderPDF(order);
    fallbackDoc.autoPrint();
    const url = URL.createObjectURL(fallbackDoc.output("blob"));
    const tab = reservedWindow ?? window.open(url, "_blank", "noopener,noreferrer");
    if (reservedWindow) reservedWindow.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!tab) throw new Error("O navegador bloqueou a janela de impressão.");
  };

  if (isMobile) {
    openPrintableTab();
    return;
  }

  const doc = createOrderPDF(order);
  const url = URL.createObjectURL(doc.output("blob"));
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.opacity = "0";
  iframe.src = url;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    iframe.onload = () => {
      try {
        if (!iframe.contentWindow) throw new Error("Visualizador de PDF indisponível.");
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        cleanup();
        resolve();
      } catch {
        cleanup();
        try {
          openPrintableTab();
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    };
    iframe.onerror = () => {
      cleanup();
      try {
        openPrintableTab();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    document.body.appendChild(iframe);
  });
};

export const reserveMobilePrintWindow = () => {
  if (!/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return null;
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  return tab;
};

// Mantém compatibilidade com os pontos existentes que já baixavam o arquivo.
export const generateOrderPDF = downloadOrderPDF;
