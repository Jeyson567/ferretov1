import { db } from "../firebase-config.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { can } from "../permissions.js";
import { saveQuote, updateQuoteStatus } from "../operations.js";
import { mountProductSearch } from "../pickers.js";
import { printHtml, quoteDocument } from "../print.js";
import { openWhatsApp, quoteText } from "../whatsapp.js";
import { dateKey, errorMessage, esc, formatDateKey, money, uid } from "../utils.js";
import { openModal, page, quoteStatusBadge, table, toast, withBusy } from "../ui.js";

defineRoute("/cotizaciones", { perm: "quotes", title: "Cotizaciones", render: renderQuotes });

async function renderQuotes(root, { params }) {
  if (params.get("nuevo") === "1" && can("quotes.create")) return renderEditor(root, null);
  if (params.get("edit") && can("quotes.edit")) return renderEditor(root, params.get("id"));
  const snap = await getDocs(query(collection(db, "quotes"), orderBy("date", "desc"), limit(150)));
  const today = dateKey();
  const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  for (const quote of rows) {
    if (["draft", "pending", "sent", "approved"].includes(quote.status) && quote.validUntil && quote.validUntil < today) {
      quote.status = "expired";
      updateQuoteStatus(quote.id, "expired").catch(() => {});
    }
  }
  const status = params.get("estado") || "";
  const visible = rows.filter((row) => !status || row.status === status);
  root.innerHTML = page({
    title: "Cotizaciones",
    subtitle: "Puede incluir productos del inventario y partidas manuales.",
    actions: can("quotes.create") ? `<a class="btn btn-primary" href="#/cotizaciones?nuevo=1">Nueva cotización</a>` : "",
    body: `<div class="filters"><label class="field"><span>Estado</span><select id="estado"><option value="">Todos</option>${["draft", "pending", "sent", "approved", "rejected", "expired", "converted"].map((item) => `<option value="${item}" ${item === status ? "selected" : ""}>${item}</option>`).join("")}</select></label></div>
      ${table([
        { label: "Número", render: (row) => esc(row.number) },
        { label: "Cliente", render: (row) => esc(row.customerName) },
        { label: "Vence", render: (row) => formatDateKey(row.validUntil) },
        { label: "Total", class: "num", render: (row) => money(row.total) },
        { label: "Estado", render: (row) => quoteStatusBadge(row.status) },
        { label: "", render: (row) => `<a class="btn btn-ghost" href="#/cotizaciones?id=${esc(row.id)}">Abrir</a>` }
      ], visible, "No hay cotizaciones.")}`
  });
  if (params.get("id") && !params.get("edit")) openQuote(params.get("id"));
  root.querySelector("#estado").addEventListener("change", () => { location.hash = `/cotizaciones?estado=${root.querySelector("#estado").value}`; });
}

async function openQuote(id) {
  const snap = await getDoc(doc(db, "quotes", id));
  if (!snap.exists()) return;
  const quote = { id: snap.id, ...snap.data() };
  const locked = quote.status === "converted";
  const modal = openModal({
    title: quote.number,
    size: "lg",
    content: `<p>${esc(quote.customerName)} · ${quoteStatusBadge(quote.status)} · vence ${formatDateKey(quote.validUntil)}</p>
      ${table([
        { label: "Partida", render: (row) => `${esc(row.name)} ${row.manual || !row.productId ? "(manual)" : ""}` },
        { label: "Cantidad", render: (row) => `${row.qty} ${esc(row.unitName || "")}` },
        { label: "Precio", class: "num", render: (row) => money(row.unitPrice) },
        { label: "Total", class: "num", render: (row) => money(row.lineTotal) }
      ], quote.items || [])}
      <p><strong>Total ${money(quote.total)}</strong></p>
      ${quote.convertedSaleNumber ? `<p>Convertida en ${esc(quote.convertedSaleNumber)}</p>` : ""}`,
    footer: `${!locked && can("quotes.edit") ? `<a class="btn btn-ghost" href="#/cotizaciones?edit=1&id=${esc(quote.id)}">Editar</a>` : ""}${!locked && can("quotes.convert") ? `<a class="btn btn-primary" href="#/pos?quote=${esc(quote.id)}">Convertir en venta</a>` : ""}
      ${can("quotes.create") ? `<button class="btn btn-ghost" id="dup" type="button">Duplicar</button>` : ""}
      ${can("quotes.print") ? `<button class="btn btn-ghost" id="print" type="button">Imprimir</button>` : ""}
      ${can("quotes.whatsapp") ? `<button class="btn btn-gold" id="wa" type="button">WhatsApp</button>` : ""}
      ${locked ? "" : `${can("quotes.whatsapp") ? `<button class="btn btn-ghost" id="sent" type="button">Marcar enviada</button>` : ""}${can("quotes.approve") ? `<button class="btn btn-ghost" id="ok" type="button">Aprobar</button>` : ""}${can("quotes.discard") ? `<button class="btn btn-danger" id="no" type="button">Rechazar</button>` : ""}`}`
  });
  modal.el.querySelector("#print")?.addEventListener("click", () => printHtml(quoteDocument(quote), "letter"));
  modal.el.querySelector("#wa")?.addEventListener("click", async () => {
    try {
      openWhatsApp(quote.customerPhone, quoteText(quote));
      if (!locked && quote.status !== "sent") await updateQuoteStatus(quote.id, "sent");
    } catch (error) { toast(error.message, "err"); }
  });
  modal.el.querySelector("#dup")?.addEventListener("click", () => duplicate(quote));
  modal.el.querySelector("#sent")?.addEventListener("click", () => setStatus(quote.id, "sent", modal));
  modal.el.querySelector("#ok")?.addEventListener("click", () => setStatus(quote.id, "approved", modal));
  modal.el.querySelector("#no")?.addEventListener("click", () => setStatus(quote.id, "rejected", modal));
}

async function setStatus(id, status, modal) {
  try { await updateQuoteStatus(id, status); toast("Estado actualizado."); modal.close(); }
  catch (error) { toast(errorMessage(error), "err"); }
}

async function duplicate(quote) {
  try {
    await saveQuote({ customerId: quote.customerId, customerName: quote.customerName, customerPhone: quote.customerPhone, items: quote.items, discount: quote.discount, validUntil: quote.validUntil, notes: quote.notes, status: "draft" });
    toast("Cotización duplicada.");
    location.hash = "/cotizaciones";
  } catch (error) { toast(errorMessage(error), "err"); }
}

async function renderEditor(root, id) {
  let existing = null;
  if (id) {
    const snap = await getDoc(doc(db, "quotes", id));
    if (!snap.exists()) throw new Error("La cotización no existe.");
    existing = { id: snap.id, ...snap.data() };
    if (existing.status === "converted") throw new Error("La cotización convertida no se puede editar.");
  }
  const state = {
    customerId: existing?.customerId || "",
    customerName: existing?.customerName || "",
    customerPhone: existing?.customerPhone || "",
    items: existing?.items ? existing.items.map((item) => ({ ...item })) : [],
    discount: existing?.discount || 0,
    validUntil: existing?.validUntil || "",
    notes: existing?.notes || "",
    status: existing?.status || "pending"
  };
  const customers = (await getDocs(query(collection(db, "customers"), orderBy("nameLower"), limit(300)))).docs.map((item) => ({ id: item.id, ...item.data() }));
  const paint = () => {
    const subtotal = state.items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0) - Number(item.discount || 0), 0);
    const total = Math.max(0, subtotal - Number(state.discount || 0));
    root.innerHTML = page({
      title: existing ? existing.number : "Nueva cotización",
      actions: `<a class="btn btn-ghost" href="#/cotizaciones">Volver</a><button class="btn btn-primary" id="save" type="button">Guardar</button>`,
      body: `<div class="pos"><section class="card"><label class="field"><span>Producto de inventario</span><input id="find" placeholder="Buscar producto"></label><div id="menu" class="suggest" hidden></div><button class="btn btn-ghost" id="manual" type="button">Partida manual</button></section>
        <section class="card stack">
          <label class="field"><span>Cliente</span><select id="customer"><option value="">Sin cliente</option>${customers.map((item) => `<option value="${esc(item.id)}" ${item.id === state.customerId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
          ${state.items.map((item, index) => `<div class="form-grid"><input data-name="${index}" value="${esc(item.name)}" ${item.productId ? "readonly" : ""}><input data-qty="${index}" type="number" step="0.001" value="${item.qty}"><input data-price="${index}" type="number" step="0.01" value="${item.unitPrice}"><input data-discount="${index}" type="number" step="0.01" value="${item.discount || 0}"><button data-remove="${index}" type="button">Quitar</button></div>`).join("")}
          <label class="field"><span>Descuento general</span><input id="discount" type="number" min="0" step="0.01" value="${state.discount}"></label>
          <label class="field"><span>Vigencia</span><input id="until" type="date" value="${esc(state.validUntil)}"></label>
          <label class="field"><span>Observaciones</span><textarea id="notes">${esc(state.notes)}</textarea></label>
          <p>Subtotal ${money(subtotal)} · <strong>Total ${money(total)}</strong></p>
        </section></div>`
    });
    mountProductSearch(root.querySelector("#find"), root.querySelector("#menu"), (product) => {
      state.items.push({ productId: product.id, code: product.code, name: product.name, qty: 1, unitId: product.unitId, unitName: product.unitName, factor: 1, unitPrice: product.price || 0, discount: 0 });
      paint();
    });
    root.querySelector("#manual").addEventListener("click", () => { state.items.push({ productId: null, manual: true, code: "MANUAL", name: "Partida manual", qty: 1, unitName: "Unidad", unitPrice: 0, discount: 0 }); paint(); });
    root.querySelector("#customer").addEventListener("change", (event) => {
      const customer = customers.find((item) => item.id === event.target.value);
      state.customerId = customer?.id || "";
      state.customerName = customer?.name || "";
      state.customerPhone = customer?.whatsapp || customer?.phone || "";
    });
    root.querySelector("#discount").addEventListener("input", (event) => { state.discount = Number(event.target.value || 0); });
    root.querySelector("#until").addEventListener("input", (event) => { state.validUntil = event.target.value; });
    root.querySelector("#notes").addEventListener("input", (event) => { state.notes = event.target.value; });
    root.querySelectorAll("[data-name]").forEach((input) => input.addEventListener("input", () => { state.items[input.dataset.name].name = input.value; }));
    root.querySelectorAll("[data-qty]").forEach((input) => input.addEventListener("change", () => { state.items[input.dataset.qty].qty = Number(input.value); paint(); }));
    root.querySelectorAll("[data-price]").forEach((input) => input.addEventListener("change", () => { state.items[input.dataset.price].unitPrice = Number(input.value); paint(); }));
    root.querySelectorAll("[data-discount]").forEach((input) => input.addEventListener("change", () => { state.items[input.dataset.discount].discount = Number(input.value); paint(); }));
    root.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { state.items.splice(Number(button.dataset.remove), 1); paint(); }));
    root.querySelector("#save").addEventListener("click", (event) => withBusy(event.currentTarget, async () => {
      try {
        await saveQuote({ id: existing?.id, number: existing?.number, ...state });
        toast("Cotización guardada.");
        location.hash = "/cotizaciones";
      } catch (error) { toast(errorMessage(error), "err"); }
    }));
  };
  paint();
}
