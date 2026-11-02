import { db } from "../firebase-config.js";
import { collection, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { readByDate } from "../lists.js";
import { printHtml, reportDocument } from "../print.js";
import { can } from "../permissions.js";
import { dateKey, downloadCsv, esc, formatDateKey, money, monthRange, qty, roundMoney, saleNet } from "../utils.js";
import { page, table, toast } from "../ui.js";

defineRoute("/reportes", { perm: "reports", title: "Reportes", render: renderReports });

const TABS = [
  ["ventas", "Ventas", "reports.sales"],
  ["productos", "Productos vendidos", "reports.sales"],
  ["ganancia", "Ganancia estimada", "reports.profit"],
  ["inventario", "Inventario", "reports.inventory"],
  ["cxc", "Cuentas por cobrar", "reports.receivables"],
  ["abonos", "Abonos", "reports.receivables"],
  ["gastos", "Gastos", "expenses.report"],
  ["clientes", "Ventas por cliente", "reports.sales"],
  ["metodos", "Métodos de pago", "reports.sales"],
  ["movimientos", "Movimientos", "reports.inventory"]
];

async function renderReports(root) {
  const month = monthRange(dateKey());
  let from = month.start;
  let to = dateKey();
  let tab = TABS.find((item) => can(item[2]))?.[0] || "";
  let current = { headers: [], rows: [], note: "" };
  const paint = () => {
    root.innerHTML = page({
      title: "Reportes",
      subtitle: "La venta facturada, el dinero cobrado y la ganancia estimada se calculan por separado.",
      actions: `${can("reports.export") ? `<button class="btn btn-ghost" id="csv" type="button">Exportar CSV</button>` : ""}${can("reports.print") ? `<button class="btn btn-primary" id="print" type="button">Imprimir</button>` : ""}`,
      body: `<div class="tabs">${TABS.filter((item) => can(item[2])).map(([id, label]) => `<button type="button" data-tab="${id}" class="${id === tab ? "active" : ""}">${label}</button>`).join("")}</div>
        <div class="filters"><label class="field"><span>Desde</span><input id="from" type="date" value="${from}"></label><label class="field"><span>Hasta</span><input id="to" type="date" value="${to}"></label><button class="btn btn-ghost" id="apply" type="button">Generar</button></div>
        <p class="help">${esc(current.note)}</p>
        ${table(current.headers.map((header, index) => ({ label: header, render: (row) => esc(row[index]) })), current.rows, "Sin datos para el filtro.")}`
    });
    root.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { tab = button.dataset.tab; run(); }));
    root.querySelector("#apply").addEventListener("click", () => { from = root.querySelector("#from").value; to = root.querySelector("#to").value; run(); });
    root.querySelector("#csv")?.addEventListener("click", () => downloadCsv(`ferretov-${tab}.csv`, [current.headers, ...current.rows]));
    root.querySelector("#print")?.addEventListener("click", () => printHtml(reportDocument(TABS.find((item) => item[0] === tab)[1], `${formatDateKey(from)} al ${formatDateKey(to)}. ${current.note}`, current.headers, current.rows), "letter"));
  };
  async function run() {
    try { current = await build(tab, from, to); paint(); }
    catch (error) { toast(error.message, "err"); }
  }
  await run();
}

async function build(tab, from, to) {
  if (!tab) return { headers: [], rows: [], note: "No tiene reportes autorizados." };
  if (tab === "inventario") return inventoryReport();
  if (tab === "cxc") return receivableReport();
  const sales = (await readByDate("sales", from, to, 500)).filter((sale) => sale.status !== "void");
  if (tab === "ventas") {
    const rows = sales.map((sale) => [sale.number, formatDateKey(sale.dateKey), sale.customerName, money(sale.total), money(sale.paid), money(sale.balance), sale.paymentStatus]);
    const total = sales.reduce((sum, sale) => sum + saleNet(sale).sold, 0);
    return { headers: ["Número", "Fecha", "Cliente", "Venta neta", "Cobrado en la venta", "Saldo", "Estado de pago"], rows, note: `Ventas netas del período: ${money(total)}. El cobrado de esta columna es el pago inicial, sin abonos posteriores.` };
  }
  if (tab === "productos") return productSales(sales);
  if (tab === "ganancia") return profitReport(sales, from, to);
  if (tab === "abonos") return paymentReport(from, to, "abono");
  if (tab === "gastos") return expenseReport(from, to);
  if (tab === "clientes") return byCustomer(sales);
  if (tab === "metodos") return byMethod(from, to, sales);
  return movementReport(from, to);
}

function productSales(sales) {
  const map = new Map();
  sales.forEach((sale) => (sale.items || []).forEach((item) => {
    const sold = Number(item.qty || 0) - Number(item.returnedQty || 0);
    const current = map.get(item.name) || { qty: 0, total: 0 };
    current.qty += sold;
    current.total += item.qty ? Number(item.lineTotal || 0) * sold / item.qty : 0;
    map.set(item.name, current);
  }));
  const ranked = [...map.entries()].sort((a, b) => b[1].qty - a[1].qty);
  return { headers: ["Producto", "Cantidad neta", "Importe"], rows: ranked.map(([name, value]) => [name, qty(value.qty), money(value.total)]), note: "Arriba están los más vendidos y abajo los de menor movimiento. Las devoluciones ya están restadas." };
}

async function profitReport(sales, from, to) {
  const expenses = (await readByDate("expenses", from, to, 300)).filter((item) => item.status !== "void");
  const payments = await readByDate("payments", from, to, 500);
  const sold = roundMoney(sales.reduce((sum, sale) => sum + saleNet(sale).sold, 0));
  const cost = roundMoney(sales.reduce((sum, sale) => sum + saleNet(sale).cost, 0));
  const profit = roundMoney(sold - cost);
  const collected = roundMoney(payments.filter((item) => ["sale", "abono"].includes(item.type) && item.methodCode !== "credit").reduce((sum, item) => sum + Number(item.amount || 0), 0) - payments.filter((item) => item.type === "refund").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const expenseTotal = roundMoney(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  return {
    headers: ["Concepto", "Monto"],
    rows: [
      ["Ventas netas facturadas", money(sold)],
      ["Costo estimado de lo vendido", money(cost)],
      ["Ganancia estimada", money(profit)],
      ["Dinero cobrado", money(collected)],
      ["Saldo aún por cobrar del período", money(sales.reduce((sum, sale) => sum + Number(sale.balance || 0), 0))],
      ["Gastos operativos", money(expenseTotal)],
      ["Resultado estimado después de gastos", money(profit - expenseTotal)]
    ],
    note: "La ganancia estimada resta el costo al precio vendido, aunque la venta esté al crédito. No es el dinero en caja. El dinero cobrado suma pagos de contado y abonos, y resta reembolsos."
  };
}

async function inventoryReport() {
  const snap = await getDocs(query(collection(db, "products"), where("active", "==", true), limit(500)));
  const rows = snap.docs.map((item) => item.data()).sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  const cost = rows.reduce((sum, item) => sum + Number(item.stock || 0) * Number(item.cost || 0), 0);
  const price = rows.reduce((sum, item) => sum + Number(item.stock || 0) * Number(item.price || 0), 0);
  return {
    headers: ["Código", "Producto", "Existencia", "Mínimo", "Costo", "Precio", "Valor al costo"],
    rows: rows.map((item) => [item.code, item.name, `${qty(item.stock)} ${item.unitName || ""}`, qty(item.minStock), money(item.cost), money(item.price), money(Number(item.stock || 0) * Number(item.cost || 0))]),
    note: `Valor del inventario al costo ${money(cost)}. Valor a precio de venta ${money(price)}. Agotados: ${rows.filter((item) => item.outOfStock).length}. Existencia baja: ${rows.filter((item) => item.lowStock).length}.`
  };
}

async function receivableReport() {
  const snap = await getDocs(query(collection(db, "receivables"), where("status", "in", ["open", "partial"]), limit(300)));
  const rows = snap.docs.map((item) => item.data());
  return { headers: ["Cliente", "Venta", "Vence", "Original", "Abonado", "Saldo"], rows: rows.map((item) => [item.customerName, item.saleNumber, formatDateKey(item.dueDate), money(item.originalAmount), money(item.paidAmount), money(item.balance)]), note: `Saldo abierto ${money(rows.reduce((sum, item) => sum + Number(item.balance || 0), 0))}.` };
}

async function paymentReport(from, to, type) {
  const rows = (await readByDate("payments", from, to, 400)).filter((item) => item.type === type);
  return { headers: ["Recibo", "Fecha", "Cliente", "Venta", "Método", "Monto"], rows: rows.map((item) => [item.number || "", formatDateKey(item.dateKey), item.customerName, item.saleNumber, item.methodName, money(item.amount)]), note: `Abonos del período ${money(rows.reduce((sum, item) => sum + Number(item.amount || 0), 0))}.` };
}

async function expenseReport(from, to) {
  const rows = (await readByDate("expenses", from, to, 300)).filter((item) => item.status !== "void");
  return { headers: ["Número", "Fecha", "Descripción", "Categoría", "Método", "Monto"], rows: rows.map((item) => [item.number, formatDateKey(item.dateKey), item.description, item.categoryName, item.paymentMethodName, money(item.amount)]), note: `Gastos ${money(rows.reduce((sum, item) => sum + Number(item.amount || 0), 0))}.` };
}

function byCustomer(sales) {
  const map = new Map();
  sales.forEach((sale) => {
    const current = map.get(sale.customerName) || { sold: 0, balance: 0 };
    current.sold += saleNet(sale).sold;
    current.balance += Number(sale.balance || 0);
    map.set(sale.customerName, current);
  });
  return { headers: ["Cliente", "Venta neta", "Saldo de esas ventas"], rows: [...map.entries()].map(([name, value]) => [name, money(value.sold), money(value.balance)]), note: "Agrupado por el nombre guardado en cada venta." };
}

async function byMethod(from, to) {
  const payments = await readByDate("payments", from, to, 500);
  const map = new Map();
  payments.forEach((item) => {
    if (item.methodCode === "credit") return;
    const sign = item.type === "refund" ? -1 : item.type === "sale" || item.type === "abono" ? 1 : 0;
    if (!sign) return;
    map.set(item.methodName, (map.get(item.methodName) || 0) + sign * Number(item.amount || 0));
  });
  return { headers: ["Método", "Dinero neto cobrado"], rows: [...map.entries()].map(([name, value]) => [name, money(value)]), note: "Incluye pagos de contado y abonos, y resta reembolsos. El crédito no es dinero cobrado." };
}

async function movementReport(from, to) {
  const rows = await readByDate("inventoryMovements", from, to, 400);
  return { headers: ["Fecha", "Producto", "Tipo", "Cantidad", "Saldo", "Referencia", "Usuario"], rows: rows.map((item) => [formatDateKey(item.dateKey), item.productName, item.type, qty(item.quantity), qty(item.newStock), item.referenceNumber || "", item.userName || ""]), note: "Cantidades en la unidad base del inventario." };
}
