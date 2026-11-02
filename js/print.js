import { getSettings } from "./state.js";
import { dateKey, esc, formatDateKey, formatDateTime, money, qty } from "./utils.js";

function company() {
  const settings = getSettings();
  const logo = settings.logoUrl || "LOGO%20FERRETOV.png";
  return { ...settings, logo, businessName: settings.businessName || "FERRETOV" };
}

function shell(title, number, dateLabel, body, format) {
  const shop = company();
  return `<article class="doc ${format === "ticket" ? "doc-ticket" : "doc-letter"}">
    <header class="doc-top">
      <img src="${esc(shop.logo)}" alt="Logo">
      <div>
        <h1>${esc(shop.businessName)}</h1>
        <p>${esc(shop.address || "")}</p>
        <p>${esc([shop.phone, shop.nit ? `NIT ${shop.nit}` : ""].filter(Boolean).join(" · "))}</p>
      </div>
      <div class="doc-id">
        <strong>${esc(title)}</strong>
        <b>${esc(number || "")}</b>
        <span>${esc(dateLabel || "")}</span>
      </div>
    </header>
    ${body}
    <footer class="doc-foot">${esc(shop.ticketFooter || "Gracias por su preferencia.")}</footer>
  </article>`;
}

function linesTable(items, ticket) {
  const head = ticket
    ? "<tr><th>Descripción</th><th>Cant.</th><th>Total</th></tr>"
    : "<tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>Unidad</th><th>Precio</th><th>Desc.</th><th>Total</th></tr>";
  const rows = items.map((item) => ticket
    ? `<tr><td>${esc(item.name)}</td><td>${qty(item.qty)}</td><td>${money(item.lineTotal)}</td></tr>`
    : `<tr><td>${esc(item.code || "")}</td><td>${esc(item.name)}</td><td>${qty(item.qty)}</td><td>${esc(item.unitName || "")}</td><td>${money(item.unitPrice)}</td><td>${money(item.discount || 0)}</td><td>${money(item.lineTotal)}</td></tr>`).join("");
  return `<table class="doc-table">${head}${rows}</table>`;
}

export function saleDocument(sale, format = "letter") {
  const customer = `<section class="doc-box"><div><span>Cliente</span><strong>${esc(sale.customerName || "Consumidor final")}</strong></div><div><span>NIT</span><strong>${esc(sale.customerNit || "CF")}</strong></div><div><span>Atendió</span><strong>${esc(sale.userName || "")}</strong></div><div><span>Estado</span><strong>${esc(sale.paymentStatus || "")}</strong></div></section>`;
  const totals = `<section class="doc-totals">
      <p><span>Subtotal</span><b>${money(sale.subtotal)}</b></p>
      <p><span>Descuento</span><b>${money(sale.discount || 0)}</b></p>
      <p class="doc-grand"><span>Total</span><b>${money(sale.total)}</b></p>
      <p><span>Pagado</span><b>${money(sale.paid || 0)}</b></p>
      <p><span>Saldo pendiente</span><b>${money(sale.balance || 0)}</b></p>
      ${sale.change ? `<p><span>Cambio</span><b>${money(sale.change)}</b></p>` : ""}
    </section>`;
  const payments = `<h3>Pagos</h3><ul class="doc-list">${(sale.payments || []).map((payment) => `<li><span>${esc(payment.methodName)}${payment.reference ? ` · ${esc(payment.reference)}` : ""}</span><b>${money(payment.amount)}</b></li>`).join("")}</ul>`;
  const later = (sale.receipts || []).length
    ? `<h3>Abonos posteriores</h3><ul class="doc-list">${sale.receipts.map((item) => `<li><span>${esc(item.number || "Abono")} · ${esc(item.methodName || "")} · ${formatDateKey(item.dateKey)}</span><b>${money(item.amount)}</b></li>`).join("")}</ul>`
    : "";
  const notes = sale.notes ? `<p class="doc-note"><strong>Observaciones:</strong> ${esc(sale.notes)}</p>` : "";
  const due = sale.dueDate ? `<p class="doc-note">Fecha de pago: ${formatDateKey(sale.dueDate)}</p>` : "";
  return shell("Comprobante de venta", sale.number, formatDateTime(sale.date), `${customer}${linesTable(sale.items || [], format === "ticket")}${totals}${payments}${later}${due}${notes}<section class="doc-sign"><div><span>Entrega</span></div><div><span>Recibe</span></div></section>`, format);
}

export function quoteDocument(quote) {
  const customer = `<section class="doc-box"><div><span>Cliente</span><strong>${esc(quote.customerName || "")}</strong></div><div><span>Vigencia</span><strong>${formatDateKey(quote.validUntil)}</strong></div><div><span>Estado</span><strong>${esc(quote.status || "")}</strong></div></section>`;
  const totals = `<section class="doc-totals"><p><span>Subtotal</span><b>${money(quote.subtotal)}</b></p><p><span>Descuento</span><b>${money(quote.discount || 0)}</b></p><p class="doc-grand"><span>Total</span><b>${money(quote.total)}</b></p></section>`;
  const notes = quote.notes ? `<p class="doc-note">${esc(quote.notes)}</p>` : "";
  return shell("Cotización", quote.number, formatDateTime(quote.date || quote.createdAt), `${customer}${linesTable(quote.items || [], false)}${totals}${notes}<p class="doc-note">Esta cotización no descuenta existencias ni constituye una venta.</p>`, "letter");
}

export function paymentDocument(payment, balance) {
  const body = `<section class="doc-box"><div><span>Cliente</span><strong>${esc(payment.customerName || "")}</strong></div><div><span>Venta</span><strong>${esc(payment.saleNumber || "")}</strong></div><div><span>Método</span><strong>${esc(payment.methodName || "")}</strong></div></section>
    <p class="doc-grand-line">Abono registrado: ${money(payment.amount)}</p>
    <p>Saldo pendiente: <strong>${balance == null ? "—" : money(balance)}</strong></p>
    ${payment.reference ? `<p>Referencia: ${esc(payment.reference)}</p>` : ""}
    ${payment.notes ? `<p class="doc-note">${esc(payment.notes)}</p>` : ""}
    <section class="doc-sign"><div><span>Recibió</span></div><div><span>Cliente</span></div></section>`;
  return shell("Recibo de abono", payment.number || "", formatDateTime(payment.date), body, "letter");
}

export function statementDocument(customer, receivables, payments) {
  const open = receivables.filter((item) => item.status !== "void" && item.status !== "paid");
  const owed = open.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const rows = open.map((item) => `<tr><td>${esc(item.saleNumber)}</td><td>${formatDateKey(item.dueDate)}</td><td>${money(item.originalAmount)}</td><td>${money(item.paidAmount)}</td><td>${money(item.balance)}</td></tr>`).join("");
  const pays = payments.slice(0, 20).map((item) => `<tr><td>${formatDateKey(item.dateKey)}</td><td>${esc(item.number || item.type)}</td><td>${esc(item.methodName || "")}</td><td>${money(item.amount)}</td></tr>`).join("");
  const body = `<section class="doc-box"><div><span>Cliente</span><strong>${esc(customer.name)}</strong></div><div><span>NIT</span><strong>${esc(customer.nit || "CF")}</strong></div><div><span>Teléfono</span><strong>${esc(customer.phone || customer.whatsapp || "")}</strong></div></section>
    <p class="doc-grand-line">Saldo pendiente: ${money(owed)}</p>
    <h3>Documentos con saldo</h3>
    <table class="doc-table"><tr><th>Documento</th><th>Vence</th><th>Original</th><th>Abonado</th><th>Saldo</th></tr>${rows || "<tr><td colspan='5'>Sin saldos abiertos</td></tr>"}</table>
    <h3>Pagos recientes</h3>
    <table class="doc-table"><tr><th>Fecha</th><th>Recibo</th><th>Método</th><th>Monto</th></tr>${pays || "<tr><td colspan='4'>Sin pagos</td></tr>"}</table>`;
  return shell("Estado de cuenta", customer.name, formatDateKey(dateKey()), body, "letter");
}

export function reportDocument(title, subtitle, headers, rows) {
  const head = headers.map((header) => `<th>${esc(header)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
  return shell(title, "", subtitle, `<table class="doc-table"><tr>${head}</tr>${body || `<tr><td colspan="${headers.length}">Sin datos</td></tr>`}</table>`, "letter");
}

export function printHtml(html, format = "letter") {
  let style = document.getElementById("print-page");
  if (!style) {
    style = document.createElement("style");
    style.id = "print-page";
    document.head.appendChild(style);
  }
  style.textContent = format === "ticket"
    ? "@media print { @page { size: 80mm auto; margin: 4mm; } }"
    : "@media print { @page { size: letter; margin: 12mm; } }";
  document.body.classList.remove("print-letter", "print-ticket");
  document.body.classList.add(format === "ticket" ? "print-ticket" : "print-letter");
  document.getElementById("print-root").innerHTML = html;
  setTimeout(() => window.print(), 80);
}
