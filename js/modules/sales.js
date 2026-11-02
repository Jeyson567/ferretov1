import { db } from "../firebase-config.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { can } from "../permissions.js";
import { readByDate } from "../lists.js";
import { registerReturn, voidSale } from "../operations.js";
import { printHtml, saleDocument } from "../print.js";
import { openWhatsApp, saleText } from "../whatsapp.js";
import { askText, confirmDialog, openModal, page, payStatusBadge, saleStatusBadge, table, toast, withBusy } from "../ui.js";
import { dateKey, errorMessage, esc, formatDateTime, money, monthRange, qty, uid } from "../utils.js";

defineRoute("/ventas", { perm: "sales", title: "Historial de ventas", render: renderSales });

async function renderSales(root, { params }) {
  const month = monthRange(dateKey());
  let from = month.start;
  let to = month.end;
  let rows = [];
  let opened = false;
  const load = async () => {
    rows = await readByDate("sales", from, to, 400);
    rows.sort((a, b) => (b.at || 0) - (a.at || 0));
    const term = root.querySelector("#q")?.value.trim().toLowerCase() || "";
    const status = root.querySelector("#status")?.value || "";
    const pay = root.querySelector("#pay")?.value || "";
    const visible = rows.filter((row) => {
      const text = `${row.number} ${row.customerName} ${row.userName}`.toLowerCase();
      return (!term || text.includes(term)) && (!status || row.status === status) && (!pay || row.paymentStatus === pay);
    });
    root.innerHTML = page({
      title: "Historial de ventas",
      subtitle: "Las ventas no se eliminan. Las anulaciones y devoluciones quedan auditadas.",
      body: `<div class="filters">
        <label class="field"><span>Desde</span><input type="date" id="from" value="${from}"></label>
        <label class="field"><span>Hasta</span><input type="date" id="to" value="${to}"></label>
        <label class="field"><span>Buscar</span><input id="q" value="${esc(term)}" placeholder="Número, cliente o vendedor"></label>
        <label class="field"><span>Venta</span><select id="status"><option value="">Todas</option><option value="completed">Completada</option><option value="partial_return">Devolución parcial</option><option value="returned">Devuelta</option><option value="void">Anulada</option></select></label>
        <label class="field"><span>Pago</span><select id="pay"><option value="">Todos</option><option value="paid">Pagada</option><option value="partial">Parcial</option><option value="credit">Crédito</option></select></label>
        <button class="btn btn-primary" id="apply" type="button">Consultar</button>
      </div>${table(columns(), visible, "No hay ventas en ese período.")}`
    });
    root.querySelector("#status").value = status;
    root.querySelector("#pay").value = pay;
    root.querySelector("#apply").addEventListener("click", () => { from = root.querySelector("#from").value; to = root.querySelector("#to").value; load().catch((error) => toast(errorMessage(error), "err")); });
    root.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => openSale(button.dataset.open)));
    if (params.get("id") && !opened) {
      opened = true;
      openSale(params.get("id"));
    }
  };
  root.innerHTML = page({ title: "Historial de ventas", body: `<div class="loading-block"><span class="spinner"></span></div>` });
  try { await load(); } catch (error) { root.innerHTML = page({ title: "Historial de ventas", body: `<div class="banner banner-danger">${esc(errorMessage(error))}</div>` }); }
}

function columns() {
  return [
    { label: "Número", render: (row) => esc(row.number) },
    { label: "Fecha", render: (row) => formatDateTime(row.date) },
    { label: "Cliente", render: (row) => esc(row.customerName) },
    { label: "Vendedor", render: (row) => esc(row.userName) },
    { label: "Total", class: "num", render: (row) => money(row.total) },
    { label: "Pago", render: (row) => payStatusBadge(row.paymentStatus) },
    { label: "Estado", render: (row) => saleStatusBadge(row.status) },
    { label: "", render: (row) => `<button class="btn btn-ghost" data-open="${esc(row.id)}" type="button">Ver</button>` }
  ];
}

async function openSale(id) {
  const snap = await getDoc(doc(db, "sales", id));
  if (!snap.exists()) return toast("La venta no existe.", "err");
  const sale = { id: snap.id, ...snap.data() };
  const canReturn = can("sales.returns");
  const canVoid = can("sales.void");
  const canPrint = can("sales.print");
  const modal = openModal({
    title: sale.number,
    size: "lg",
    content: `<p>${formatDateTime(sale.date)} · ${esc(sale.customerName)} · ${esc(sale.userName)}</p><p>${saleStatusBadge(sale.status)} ${payStatusBadge(sale.paymentStatus)}</p>
      ${table([
        { label: "Producto", render: (row) => esc(row.name) },
        { label: "Cantidad", render: (row) => `${qty(row.qty)} ${esc(row.unitName || "")}` },
        { label: "Devuelto", render: (row) => qty(row.returnedQty || 0) },
        { label: "Precio", class: "num", render: (row) => money(row.unitPrice) },
        { label: "Total", class: "num", render: (row) => money(row.lineTotal) }
      ], sale.items || [])}
      <p>Subtotal ${money(sale.subtotal)} · Descuento ${money(sale.discount || 0)} · <strong>Total ${money(sale.total)}</strong></p>
      <p>Pagado ${money(sale.paid || 0)} · Saldo ${money(sale.balance || 0)} · Reembolsado ${money(sale.refunded || 0)}</p>
      <h3>Pagos de la venta</h3>
      ${(sale.payments || []).map((item) => `<p>${esc(item.methodName)} ${item.reference ? `· ${esc(item.reference)}` : ""} <strong>${money(item.amount)}</strong></p>`).join("")}
      ${(sale.receipts || []).length ? `<h3>Abonos</h3>${sale.receipts.map((item) => `<p>${esc(item.number)} · ${esc(item.methodName)} · ${money(item.amount)}</p>`).join("")}` : ""}
      ${(sale.returns || []).length ? `<h3>Devoluciones</h3>${sale.returns.map((item) => `<p>${esc(item.number)} · ${money(item.amount)} · ${esc(item.reason)}</p>`).join("")}` : ""}
      ${sale.notes ? `<p class="help">${esc(sale.notes)}</p>` : ""}
      ${sale.voidReason ? `<p class="banner banner-danger">Anulada: ${esc(sale.voidReason)}</p>` : ""}`,
    footer: `${canPrint ? `<button class="btn btn-primary" id="letter" type="button">Imprimir carta</button><button class="btn btn-ghost" id="ticket" type="button">Ticket</button>` : ""}${can("sales.detail") ? `<button class="btn btn-ghost" id="wa" type="button">WhatsApp</button>` : ""}${sale.status !== "void" && canReturn ? `<button class="btn btn-ghost" id="return" type="button">Devolución</button>` : ""}${sale.status !== "void" && canVoid ? `<button class="btn btn-danger" id="void" type="button">Anular</button>` : ""}`
  });
  modal.el.querySelector("#letter")?.addEventListener("click", () => printHtml(saleDocument(sale, "letter"), "letter"));
  modal.el.querySelector("#ticket")?.addEventListener("click", () => printHtml(saleDocument(sale, "ticket"), "ticket"));
  modal.el.querySelector("#wa")?.addEventListener("click", () => {
    try { openWhatsApp(sale.customerPhone, saleText(sale)); }
    catch (error) { toast(error.message, "err"); }
  });
  modal.el.querySelector("#return")?.addEventListener("click", () => returnForm(sale, modal));
  modal.el.querySelector("#void")?.addEventListener("click", () => voidForm(sale, modal));
}

function returnForm(sale, parent) {
  const lines = (sale.items || []).map((item, index) => {
    const available = Number(item.qty || 0) - Number(item.returnedQty || 0);
    if (available <= 0) return "";
    return `<label class="check"><input type="checkbox" data-index="${index}"> ${esc(item.name)} · devolver <input data-qty="${index}" type="number" min="0.001" max="${available}" step="0.001" value="${available}" style="width:90px"> de ${qty(available)}</label>`;
  }).join("");
  const modal = openModal({
    title: `Devolución ${sale.number}`,
    content: `<div class="stack">${lines || "<p>No queda cantidad por devolver.</p>"}<label class="field req"><span>Motivo</span><textarea id="reason" required></textarea></label></div>`,
    footer: `<button class="btn btn-primary" id="save-return" type="button">Registrar devolución</button>`
  });
  modal.el.querySelector("#save-return").addEventListener("click", async (event) => {
    const selected = [...modal.body.querySelectorAll("[data-index]:checked")].map((input) => ({ index: Number(input.dataset.index), qty: modal.body.querySelector(`[data-qty="${input.dataset.index}"]`).value }));
    await withBusy(event.currentTarget, async () => {
      try {
        await registerReturn({ requestId: uid(), saleId: sale.id, lines: selected, reason: modal.body.querySelector("#reason").value });
        toast("Devolución registrada y existencias repuestas.");
        modal.close();
        parent.close();
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
}

async function voidForm(sale, parent) {
  const ok = await confirmDialog({ title: "Anular venta", message: "Se repondrán las existencias pendientes, se cancelará el saldo y quedará el registro. Esta acción no borra la venta.", confirmText: "Anular", danger: true, requireText: "ANULAR" });
  if (!ok) return;
  const reason = await askText({ title: "Anular venta", label: "Motivo", confirmText: "Anular", required: true });
  if (!reason) return;
  try {
    await voidSale({ requestId: uid(), saleId: sale.id, reason });
    toast("Venta anulada.");
    parent.close();
  } catch (error) { toast(errorMessage(error), "err"); }
}
