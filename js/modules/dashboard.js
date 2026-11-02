import { db } from "../firebase-config.js";
import { collection, getCountFromServer, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute, go } from "../router.js";
import { getSession } from "../auth.js";
import { can } from "../permissions.js";
import { mapDocs, readByDate } from "../lists.js";
import { badge, emptyState, page, table } from "../ui.js";
import { dateKey, esc, formatDateKey, money, monthRange, qty, saleNet } from "../utils.js";

defineRoute("/", { perm: "dashboard", title: "Panel", render: renderDashboard });

async function renderDashboard(root) {
  const session = getSession();
  const today = dateKey();
  const month = monthRange(today);
  let from = month.start;
  let to = month.end;
  const seeSales = can("dashboard.viewSales") || can("dashboard.viewProfits") || can("dashboard.viewRecent");
  const seeProfit = can("dashboard.viewProfits");
  const seeCustomers = can("customers.view");
  const seeReceivables = can("receivables.view");
  const seeQuotes = can("quotes.view");
  const seeExpenses = can("expenses.view");
  const seeStock = can("inventory.view");
  const seeMoves = can("inventory.movements") && can("dashboard.viewRecent");
  const draw = (body) => {
    root.innerHTML = page({
      title: `Buen día, ${esc(session.name.split(" ")[0])}`,
      subtitle: "Indicadores calculados con los registros de Firestore.",
      actions: actions(),
      body
    });
    root.querySelector("#apply-range")?.addEventListener("click", () => {
      from = root.querySelector("[name=from]").value || from;
      to = root.querySelector("[name=to]").value || to;
      load();
    });
  };
  draw(`<div class="loading-block"><span class="spinner"></span> Calculando el panel…</div>`);
  await load();

  async function load() {
    const spanStart = from < month.start ? from : month.start;
    const spanEnd = to > today ? to : today > month.end ? to : month.end;
    const end = [to, month.end, today].sort().at(-1);
    const start = [from, month.start].sort()[0];
    try {
      const [sales, expenses, receivables, quotes, lowSnap, movements, counts] = await Promise.all([
        seeSales ? readByDate("sales", start, end, 500) : [],
        seeExpenses ? readByDate("expenses", start, end, 300) : [],
        seeReceivables ? mapDocs(await getDocs(query(collection(db, "receivables"), where("status", "in", ["open", "partial"]), limit(300)))) : [],
        seeQuotes ? mapDocs(await getDocs(query(collection(db, "quotes"), where("status", "in", ["draft", "pending", "sent", "approved"]), limit(100)))) : [],
        seeStock ? getDocs(query(collection(db, "products"), where("lowStock", "==", true), limit(8))) : { docs: [] },
        seeMoves ? mapDocs(await getDocs(query(collection(db, "inventoryMovements"), limit(8)))) : [],
        countsFor(seeCustomers, seeStock)
      ]);
      const activeSales = sales.filter((sale) => sale.status !== "void");
      const inMonth = (sale) => sale.dateKey >= month.start && sale.dateKey <= month.end;
      const inToday = (sale) => sale.dateKey === today;
      const inRange = (sale) => sale.dateKey >= from && sale.dateKey <= to;
      const sumSales = (list) => list.reduce((total, sale) => total + saleNet(sale).sold, 0);
      const monthSales = activeSales.filter(inMonth);
      const todaySales = activeSales.filter(inToday);
      const rangeSales = activeSales.filter(inRange);
      const profit = rangeSales.reduce((total, sale) => total + saleNet(sale).profit, 0);
      const expensesToday = expenses.filter((item) => item.dateKey === today && item.status !== "void").reduce((total, item) => total + Number(item.amount || 0), 0);
      const expensesRange = expenses.filter((item) => item.status !== "void" && inRange(item)).reduce((total, item) => total + Number(item.amount || 0), 0);
      const receivableTotal = receivables.reduce((total, item) => total + Number(item.balance || 0), 0);
      const overdue = receivables.filter((item) => item.dueDate && item.dueDate < today).length;
      const pendingQuotes = quotes.filter((item) => !item.validUntil || item.validUntil >= today).length;
      const top = topProducts(rangeSales);
      const recent = [...activeSales].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 6);
      draw(`${filters()}
        <section class="kpis">
          ${seeSales ? kpi("Ventas de hoy", money(sumSales(todaySales)), `${todaySales.length} operaciones`) : ""}
          ${seeSales ? kpi("Ventas del mes", money(sumSales(monthSales)), formatDateKey(month.start) + " al " + formatDateKey(month.end)) : ""}
          ${seeStock ? kpi("Productos activos", counts.products, `${counts.low} con existencia baja`) : ""}
          ${seeStock ? kpi("Agotados", counts.out, "Existencia en cero") : ""}
          ${seeCustomers ? kpi("Clientes", counts.customers, "Registros activos") : ""}
          ${seeReceivables ? kpi("Por cobrar", money(receivableTotal), `${overdue} cuentas vencidas`) : ""}
          ${seeQuotes ? kpi("Cotizaciones abiertas", pendingQuotes, "Sin convertir ni vencer") : ""}
          ${seeProfit ? kpi("Ganancia estimada", money(profit), "Precio menos costo, no es efectivo") : ""}
          ${seeExpenses ? kpi("Gastos de hoy", money(expensesToday), `Período ${money(expensesRange)}`) : ""}
        </section>
        <section class="split">
          <article class="card"><h2>Ventas del período</h2><canvas id="chart" class="chart"></canvas></article>
          <article class="card"><h2>Productos más vendidos</h2>${top.length ? top.map((item) => `<p><strong>${esc(item.name)}</strong><br><span class="muted">${qty(item.qty)} · ${money(item.total)}</span></p>`).join("") : emptyState("Sin ventas", "En el período elegido no hay productos vendidos.")}</article>
        </section>
        <section class="split" style="margin-top:14px">
          <article class="card"><h2>Últimas ventas</h2>${seeSales || can("dashboard.viewRecent") ? recentTable(recent, true) : emptyState("Sin acceso", "No tiene permiso para ver las ventas recientes.")}</article>
          <article class="card"><h2>${seeMoves ? "Movimientos recientes" : "Existencias bajas"}</h2>${seeMoves ? movementList(movements) : seeStock ? lowList(lowSnap) : emptyState("Sin acceso", "No tiene permiso para ver existencias.")}</article>
        </section>`);
      root.querySelector("#apply-range").addEventListener("click", () => {
        from = root.querySelector("[name=from]").value || from;
        to = root.querySelector("[name=to]").value || to;
        load();
      });
      drawChart(rangeSales, from, to);
    } catch (error) {
      draw(`<div class="banner banner-danger">${esc(error.message || "No se pudo cargar el panel.")}</div>`);
    }
  }

  function filters() {
    return `<div class="filters"><label class="field"><span>Desde</span><input type="date" name="from" value="${from}"></label><label class="field"><span>Hasta</span><input type="date" name="to" value="${to}"></label><button class="btn btn-primary" id="apply-range" type="button">Aplicar</button></div>`;
  }
  function actions() {
    return [
      can("pos.create") ? `<button class="btn btn-primary" type="button" data-go="/pos">Nueva venta</button>` : "",
      can("inventory.view") ? `<button class="btn btn-ghost" type="button" data-go="/inventario">Productos</button>` : "",
      can("quotes.create") ? `<button class="btn btn-ghost" type="button" data-go="/cotizaciones?nuevo=1">Cotización</button>` : "",
      can("receivables.abono") || can("receivables.payFull") ? `<button class="btn btn-ghost" type="button" data-go="/cxc">Abonos</button>` : ""
    ].join("");
  }
}

function kpi(label, value, note) {
  return `<article class="kpi"><span>${label}</span><strong>${value}</strong><em>${note}</em></article>`;
}

async function countsFor(seeCustomers, seeStock) {
  if (!seeStock && !seeCustomers) return { products: "—", low: 0, out: 0, customers: "—" };
  const products = seeStock ? await getCountFromServer(query(collection(db, "products"), where("active", "==", true))) : null;
  const low = seeStock ? await getCountFromServer(query(collection(db, "products"), where("lowStock", "==", true))) : null;
  const out = seeStock ? await getCountFromServer(query(collection(db, "products"), where("outOfStock", "==", true))) : null;
  const customers = seeCustomers ? await getCountFromServer(query(collection(db, "customers"), where("active", "==", true))) : null;
  return {
    products: products ? products.data().count : "—",
    low: low ? low.data().count : 0,
    out: out ? out.data().count : 0,
    customers: customers ? customers.data().count : 0
  };
}

function topProducts(sales) {
  const map = new Map();
  sales.forEach((sale) => (sale.items || []).forEach((item) => {
    const key = item.productId || item.name;
    const current = map.get(key) || { name: item.name, qty: 0, total: 0 };
    const returned = Number(item.returnedQty || 0);
    current.qty += Number(item.qty || 0) - returned;
    current.total += Number(item.lineTotal || 0) * (item.qty ? (item.qty - returned) / item.qty : 0);
    map.set(key, current);
  }));
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
}

function recentTable(rows, financial) {
  if (!financial) return emptyState("Sin acceso", "Las ventas están disponibles para administración y ventas.");
  return table([
    { label: "Número", render: (row) => esc(row.number) },
    { label: "Cliente", render: (row) => esc(row.customerName) },
    { label: "Total", class: "num", render: (row) => money(row.total) },
    { label: "Estado", render: (row) => badge(row.status === "void" ? "Anulada" : "Registrada", row.status === "void" ? "danger" : "ok") }
  ], rows, "Aún no hay ventas en el período.");
}

function lowList(snap) {
  const rows = mapDocs(snap);
  if (!rows.length) return emptyState("Inventario estable", "No hay productos en el mínimo o por debajo.");
  return rows.map((item) => `<p><strong>${esc(item.name)}</strong><br><span class="muted">${qty(item.stock)} ${esc(item.unitName || "")}</span></p>`).join("");
}

function movementList(rows) {
  if (!rows.length) return emptyState("Sin movimientos", "Las entradas, ventas y ajustes aparecerán aquí.");
  return rows.map((item) => `<p><strong>${esc(item.productName || "")}</strong><br><span class="muted">${esc(item.type)} · ${qty(item.quantity)}</span></p>`).join("");
}

function drawChart(sales, from, to) {
  const canvas = document.getElementById("chart");
  if (!canvas) return;
  const days = [];
  let cursor = from;
  while (cursor <= to && days.length < 31) {
    days.push(cursor);
    cursor = next(cursor);
  }
  const values = days.map((day) => sales.filter((sale) => sale.dateKey === day).reduce((total, sale) => total + saleNet(sale).sold, 0));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(rect.width, 320);
  const height = 240;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  const max = Math.max(...values, 1);
  const gap = 8;
  const bar = (width - 24) / days.length - gap;
  values.forEach((value, index) => {
    const h = (value / max) * 170;
    const x = 16 + index * (bar + gap);
    ctx.fillStyle = "#d4a017";
    ctx.fillRect(x, 190 - h, Math.max(bar, 2), h);
    if (days.length <= 12) {
      ctx.fillStyle = "#6b645b";
      ctx.font = "11px Segoe UI";
      ctx.fillText(days[index].slice(8), x, 210);
    }
  });
}

function next(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  return date.toISOString().slice(0, 10);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-go]");
  if (button && document.getElementById("view")?.contains(button)) go(button.dataset.go);
});
