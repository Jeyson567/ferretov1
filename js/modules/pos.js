import { db } from "../firebase-config.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { can } from "../permissions.js";
import { getMethods } from "../state.js";
import { mountProductSearch } from "../pickers.js";
import { finalizeSale } from "../operations.js";
import { openCustomerForm } from "./customers.js";
import { printHtml, saleDocument } from "../print.js";
import { openWhatsApp, saleText } from "../whatsapp.js";
import { confirmDialog, openModal, page, toast, withBusy } from "../ui.js";
import { dateKey, errorMessage, esc, money, qty, roundMoney, roundQty, uid } from "../utils.js";

defineRoute("/pos", { perm: "pos", title: "Punto de venta", render: renderPos });

const cart = emptyCart();
let repaint = () => {};

function emptyCart() {
  return { items: [], customer: null, discount: 0, payments: [], notes: "", dueDate: "", cashTendered: "", quoteId: null, quoteNumber: null, requestId: null };
}

async function renderPos(root, { params }) {
  const quoteId = params.get("quote");
  if (quoteId && cart.quoteId !== quoteId) await loadQuote(quoteId);
  const customers = await loadCustomers();
  root.innerHTML = page({
    title: "Punto de venta",
    subtitle: cart.quoteNumber ? `Convirtiendo la cotización ${esc(cart.quoteNumber)}` : "Busque el producto, arme el pedido y registre el pago.",
    actions: `<button class="btn btn-ghost" id="clear-cart" type="button">Vaciar</button>`,
    body: `<div class="pos"><section class="card"><label class="field"><span>Producto</span><input id="product-search" placeholder="Nombre, código o código de barras" autocomplete="off"></label><div id="product-menu" class="suggest" hidden></div><div id="picked" class="help">El lector de barras funciona al presionar Enter.</div></section><section class="card pos-cart" id="cart-box"></section></div>`
  });
  mountProductSearch(root.querySelector("#product-search"), root.querySelector("#product-menu"), (product) => addProduct(product));
  root.querySelector("#clear-cart").addEventListener("click", async () => {
    if (!cart.items.length || !can("pos.cancel")) return;
    const ok = await confirmDialog({ title: "Vaciar venta", message: "Se quitarán los productos del carrito. No se ha guardado ninguna venta." });
    if (!ok) return;
    Object.assign(cart, emptyCart());
    paint();
  });
  function paint() {
    const view = preview();
    const methods = getMethods();
    const box = root.querySelector("#cart-box");
    if (!box) return;
    box.innerHTML = `${cart.items.length ? cart.items.map((item, index) => line(item, index)).join("") : `<div class="empty"><strong>Carrito vacío</strong><p>Agregue productos para iniciar la venta.</p></div>`}
      <div class="totals" id="totals"></div>
      <label class="field"><span>Descuento general</span><input id="global-discount" type="number" min="0" step="0.01" value="${cart.discount || ""}" ${can("pos.discount") ? "" : "readonly"}></label>
      <div class="stack">
        <div class="inline-actions">${can("pos.customers") ? `<button class="btn btn-ghost" id="pick-customer" type="button">${cart.customer ? esc(cart.customer.name) : "Consumidor final"}</button><button class="btn btn-ghost" id="new-customer" type="button">Nuevo cliente</button>` : `<p class="help">Consumidor final</p>`}</div>
        <label class="field"><span>Observaciones</span><textarea id="notes">${esc(cart.notes)}</textarea></label>
        <div id="payments">${cart.payments.map((payment, index) => payRow(payment, index, methods)).join("")}</div>
        <div class="inline-actions"><button class="btn btn-ghost" id="add-pay" type="button">Agregar pago</button>${can("pos.credit") ? `<button class="btn btn-gold" id="fill-credit" type="button">Completar con crédito</button>` : ""}</div>
        <label class="field"><span>Efectivo entregado</span><input id="tendered" type="number" min="0" step="0.01" value="${esc(cart.cashTendered)}"></label>
        <label class="field"><span>Fecha de pago del crédito</span><input id="due" type="date" value="${esc(cart.dueDate)}"></label>
        ${can("pos.create") ? `<button class="btn btn-primary" id="finish" type="button">Finalizar venta</button>` : `<p class="help">No tiene permiso para registrar la venta.</p>`}
      </div>`;
    bind(customers);
  }

  function bind(customerRows) {
    const box = root.querySelector("#cart-box");
    box.querySelector("#global-discount").addEventListener("input", (event) => { cart.discount = Number(event.target.value || 0); cart.requestId = null; refreshTotals(); });
    box.querySelector("#notes").addEventListener("input", (event) => { cart.notes = event.target.value; });
    box.querySelector("#tendered").addEventListener("input", (event) => { cart.cashTendered = event.target.value; refreshTotals(); });
    box.querySelector("#due").addEventListener("input", (event) => { cart.dueDate = event.target.value; });
    box.querySelectorAll("[data-qty]").forEach((input) => input.addEventListener("input", () => updateLine(input.dataset.qty, "qty", input.value)));
    box.querySelectorAll("[data-price]").forEach((input) => input.addEventListener("input", () => updateLine(input.dataset.price, "unitPrice", input.value)));
    box.querySelectorAll("[data-line-discount]").forEach((input) => input.addEventListener("input", () => updateLine(input.dataset.lineDiscount, "discount", input.value)));
    box.querySelectorAll("[data-unit]").forEach((select) => select.addEventListener("change", () => changeUnit(select.dataset.unit, select.value)));
    box.querySelectorAll("[data-wholesale]").forEach((input) => input.addEventListener("change", () => toggleWholesale(input.dataset.wholesale, input.checked)));
    box.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { cart.items.splice(Number(button.dataset.remove), 1); cart.requestId = null; paint(); }));
    box.querySelectorAll("[data-method]").forEach((select) => select.addEventListener("change", () => { cart.payments[select.dataset.method].methodId = select.value; cart.requestId = null; refreshTotals(); }));
    box.querySelectorAll("[data-amount]").forEach((input) => input.addEventListener("input", () => { cart.payments[input.dataset.amount].amount = input.value; cart.requestId = null; refreshTotals(); }));
    box.querySelectorAll("[data-reference]").forEach((input) => input.addEventListener("input", () => { cart.payments[input.dataset.reference].reference = input.value; }));
    box.querySelectorAll("[data-pay-remove]").forEach((button) => button.addEventListener("click", () => { cart.payments.splice(Number(button.dataset.payRemove), 1); paint(); }));
    box.querySelector("#add-pay").addEventListener("click", () => { cart.payments.push({ methodId: getMethods()[0]?.id || "", amount: "", reference: "" }); paint(); });
    box.querySelector("#fill-credit")?.addEventListener("click", () => {
      const credit = getMethods().find((item) => item.code === "credit");
      if (!credit) return toast("No hay un método de crédito activo.", "err");
      if (!cart.customer) return toast("Seleccione un cliente para vender al crédito.", "err");
      const current = preview();
      if (current.difference <= 0) return toast("El pago ya cubre el total.");
      cart.payments.push({ methodId: credit.id, amount: current.difference, reference: "" });
      if (!cart.dueDate) cart.dueDate = dateKey();
      paint();
    });
    box.querySelector("#pick-customer")?.addEventListener("click", () => pickCustomer(customerRows));
    box.querySelector("#new-customer")?.addEventListener("click", async () => {
      const created = await openCustomerForm();
      if (!created) return;
      customerRows.push(created);
      cart.customer = created;
      paint();
    });
    box.querySelector("#finish")?.addEventListener("click", (event) => finish(event.currentTarget));
    refreshTotals();
  }

  function refreshTotals() {
    const view = preview();
    const node = root.querySelector("#totals");
    if (!node) return;
    node.innerHTML = `<p><span>Subtotal</span><b>${money(view.subtotal)}</b></p><p class="grand"><span>Total</span><b>${money(view.total)}</b></p><p><span>Asignado</span><b>${money(view.assigned)}</b></p><p><span>Diferencia</span><b>${money(view.difference)}</b></p><p><span>Recibido</span><b>${money(view.received)}</b></p><p><span>Crédito</span><b>${money(view.credit)}</b></p><p><span>Cambio</span><b>${money(change(view))}</b></p>`;
  }
  repaint = paint;
  paint();
}

function line(item, index) {
  const locked = !can("pos.changePrice");
  const noDiscount = !can("pos.discount");
  const units = item.units || [{ unitId: item.unitId, unitName: item.unitName, factor: item.factor || 1 }];
  const base = roundQty(Number(item.qty || 0) * Number(item.factor || 1));
  return `<article><header class="inline-actions"><strong>${esc(item.name)}</strong><button class="btn btn-ghost" data-remove="${index}" type="button">Quitar</button></header>
    <p class="line-note">${esc(item.code || "")} · Disponible ${item.stock == null ? "—" : `${qty(item.stock)} ${esc(item.baseUnit || item.unitName || "")}`}</p>
    <div class="form-grid">
      <label class="field"><span>Cantidad</span><input data-qty="${index}" type="number" min="0.001" step="0.001" value="${item.qty}"></label>
      <label class="field"><span>Unidad</span><select data-unit="${index}">${units.map((unit) => `<option value="${esc(unit.unitId)}" ${unit.unitId === item.unitId ? "selected" : ""}>${esc(unit.unitName)}</option>`).join("")}</select></label>
      <label class="field"><span>Precio</span><input data-price="${index}" type="number" min="0" step="0.01" value="${item.unitPrice}" ${locked ? "readonly" : ""}></label>
      <label class="field"><span>Descuento</span><input data-line-discount="${index}" type="number" min="0" step="0.01" value="${item.discount || ""}" ${noDiscount ? "readonly" : ""}></label>
    </div>
    ${item.wholesalePrice ? `<label class="check"><input type="checkbox" data-wholesale="${index}" ${item.wholesale ? "checked" : ""}> Precio mayorista</label>` : ""}
    <p class="line-note">Descuenta ${qty(base)} ${esc(item.baseUnit || item.unitName || "")}. Importe ${money(lineTotal(item))}</p></article>`;
}

function payRow(payment, index, methods) {
  return `<div class="pay-row"><select data-method="${index}">${methods.map((method) => `<option value="${esc(method.id)}" ${method.id === payment.methodId ? "selected" : ""}>${esc(method.name)}</option>`).join("")}</select><input data-amount="${index}" type="number" min="0.01" step="0.01" value="${payment.amount}" placeholder="Monto"><input data-reference="${index}" value="${esc(payment.reference || "")}" placeholder="Referencia"><button type="button" data-pay-remove="${index}">×</button></div>`;
}

function addProduct(product) {
  cart.items.push({
    localId: uid(),
    productId: product.id,
    manual: false,
    code: product.code,
    name: product.name,
    qty: 1,
    unitId: product.unitId,
    unitName: product.unitName,
    factor: 1,
    baseUnit: product.unitName,
    unitPrice: product.price || 0,
    listPrice: product.price || 0,
    wholesalePrice: product.wholesalePrice,
    discount: 0,
    stock: product.stock,
    units: [{ unitId: product.unitId, unitName: product.unitName, factor: 1 }, ...(product.conversions || [])]
  });
  cart.requestId = null;
  const picked = document.getElementById("picked");
  if (picked) picked.textContent = `${product.name} agregado.`;
  repaint();
}

function updateLine(index, key, value) {
  cart.items[index][key] = Number(value || 0);
  cart.requestId = null;
  const article = document.querySelector(`[data-qty="${index}"]`)?.closest("article");
  if (article) {
    const item = cart.items[index];
    const note = article.querySelectorAll(".line-note")[1];
    if (note) note.textContent = `Descuenta ${qty(roundQty(item.qty * item.factor))} ${item.baseUnit || item.unitName || ""}. Importe ${money(lineTotal(item))}`;
  }
  document.getElementById("global-discount")?.dispatchEvent(new Event("input"));
}

function changeUnit(index, unitId) {
  const item = cart.items[index];
  const unit = item.units.find((entry) => entry.unitId === unitId) || item.units[0];
  item.unitId = unit.unitId;
  item.unitName = unit.unitName;
  item.factor = Number(unit.factor || 1);
  item.unitPrice = roundMoney((item.wholesale && item.wholesalePrice != null ? item.wholesalePrice : item.listPrice) * item.factor);
  cart.requestId = null;
  repaint();
}

function toggleWholesale(index, checked) {
  const item = cart.items[index];
  item.wholesale = checked;
  item.unitPrice = roundMoney((checked && item.wholesalePrice != null ? item.wholesalePrice : item.listPrice) * item.factor);
  cart.requestId = null;
  repaint();
}

function lineTotal(item) {
  return roundMoney(Math.max(0, roundMoney(item.qty * item.unitPrice) - roundMoney(item.discount || 0)));
}

function preview() {
  const subtotal = roundMoney(cart.items.reduce((sum, item) => sum + lineTotal(item), 0));
  const discount = Math.min(roundMoney(cart.discount || 0), subtotal);
  const total = roundMoney(subtotal - discount);
  const methods = new Map(getMethods().map((method) => [method.id, method]));
  const payments = cart.payments.map((payment) => ({ ...payment, amount: roundMoney(payment.amount || 0), code: methods.get(payment.methodId)?.code }));
  const assigned = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const credit = roundMoney(payments.filter((payment) => payment.code === "credit").reduce((sum, payment) => sum + payment.amount, 0));
  const received = roundMoney(assigned - credit);
  return { subtotal, discount, total, assigned, difference: roundMoney(total - assigned), credit, received, cash: roundMoney(payments.filter((payment) => payment.code === "cash").reduce((sum, payment) => sum + payment.amount, 0)) };
}

function change(view = preview()) {
  const tendered = roundMoney(cart.cashTendered || 0);
  if (!tendered) return 0;
  return roundMoney(Math.max(0, tendered - view.cash));
}

async function finish(button) {
  const view = preview();
  if (!cart.items.length) return toast("Agregue productos a la venta.", "err");
  if (Math.abs(view.difference) > 0.001) return toast("La suma de los pagos debe ser igual al total.", "err");
  if (view.credit > 0 && !cart.customer) return toast("Seleccione un cliente para el saldo al crédito.", "err");
  if (view.credit > 0 && !cart.dueDate) return toast("Indique la fecha de pago.", "err");
  const ok = await confirmDialog({ title: "Finalizar venta", message: `Se registrará una venta por ${money(view.total)} y se descontarán las existencias.`, confirmText: "Registrar venta" });
  if (!ok) return;
  if (!cart.requestId) cart.requestId = uid();
  await withBusy(button, async () => {
    try {
      const result = await finalizeSale({
        requestId: cart.requestId,
        customerId: cart.customer?.id || null,
        items: cart.items.map((item) => ({ productId: item.productId, name: item.name, qty: item.qty, unitId: item.unitId, unitPrice: item.unitPrice, discount: item.discount || 0, unitName: item.unitName })),
        discount: view.discount,
        payments: cart.payments.filter((payment) => roundMoney(payment.amount) > 0).map((payment) => ({ methodId: payment.methodId, amount: payment.amount, reference: payment.reference })),
        notes: cart.notes,
        dueDate: cart.dueDate,
        quoteId: cart.quoteId,
        cashTendered: roundMoney(cart.cashTendered || 0)
      });
      const sale = result.sale;
      Object.assign(cart, emptyCart());
      repaint();
      done(sale, result.duplicate);
    } catch (error) { toast(errorMessage(error), "err"); }
  });
}

function done(sale, duplicate) {
  const modal = openModal({
    title: duplicate ? "La venta ya estaba registrada" : "Venta registrada",
    content: `<p>Número <strong>${esc(sale.number)}</strong></p><p>Total ${money(sale.total)} · Saldo ${money(sale.balance || 0)}</p>`,
    footer: `<button class="btn btn-primary" id="print-letter" type="button">Imprimir carta</button><button class="btn btn-ghost" id="print-ticket" type="button">Ticket</button><button class="btn btn-ghost" id="wa-sale" type="button">WhatsApp</button><button class="btn btn-ghost" data-close type="button">Nueva venta</button>`
  });
  modal.el.querySelector("#print-letter").addEventListener("click", () => printHtml(saleDocument(sale, "letter"), "letter"));
  modal.el.querySelector("#print-ticket").addEventListener("click", () => printHtml(saleDocument(sale, "ticket"), "ticket"));
  modal.el.querySelector("#wa-sale").addEventListener("click", () => {
    try { openWhatsApp(sale.customerPhone, saleText(sale)); }
    catch (error) { toast(error.message, "err"); }
  });
}

function pickCustomer(customers) {
  const modal = openModal({
    title: "Seleccionar cliente",
    content: `<input id="customer-q" placeholder="Buscar cliente"><div id="customer-list"></div>`,
    footer: `<button class="btn btn-ghost" id="no-customer" type="button">Consumidor final</button>`
  });
  const paint = () => {
    const term = modal.body.querySelector("#customer-q").value.trim().toLowerCase();
    const rows = customers.filter((item) => item.name.toLowerCase().includes(term)).slice(0, 30);
    modal.body.querySelector("#customer-list").innerHTML = rows.map((item) => `<button class="btn btn-ghost" data-id="${esc(item.id)}" type="button">${esc(item.name)}<small>${esc(item.phone || item.nit || "")}</small></button>`).join("") || `<p class="help">No hay clientes.</p>`;
    modal.body.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => {
      cart.customer = customers.find((item) => item.id === button.dataset.id);
      modal.close();
      repaint();
    }));
  };
  modal.body.querySelector("#customer-q").addEventListener("input", paint);
  modal.el.querySelector("#no-customer").addEventListener("click", () => { cart.customer = null; modal.close(); repaint(); });
  paint();
}

async function loadCustomers() {
  const snap = await getDocs(query(collection(db, "customers"), orderBy("nameLower"), limit(400)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.active !== false);
}

async function loadQuote(quoteId) {
  const snap = await getDoc(doc(db, "quotes", quoteId));
  if (!snap.exists()) throw new Error("La cotización no existe.");
  const quote = snap.data();
  if (quote.status === "converted") throw new Error("Esa cotización ya fue convertida.");
  Object.assign(cart, emptyCart(), {
    quoteId,
    quoteNumber: quote.number,
    notes: quote.notes || "",
    discount: quote.discount || 0,
    customer: quote.customerId ? { id: quote.customerId, name: quote.customerName, phone: quote.customerPhone || "" } : null,
    items: []
  });
  for (const item of quote.items || []) {
    let product = null;
    if (item.productId) {
      const productSnap = await getDoc(doc(db, "products", item.productId));
      product = productSnap.exists() ? { id: productSnap.id, ...productSnap.data() } : null;
    }
    cart.items.push({
      localId: uid(),
      productId: item.productId || null,
      manual: !item.productId,
      code: item.code,
      name: item.name,
      qty: item.qty,
      unitId: item.unitId || product?.unitId || "",
      unitName: item.unitName,
      factor: item.factor || 1,
      baseUnit: product?.unitName || item.unitName,
      unitPrice: item.unitPrice,
      listPrice: product?.price || item.unitPrice,
      wholesalePrice: product?.wholesalePrice,
      discount: item.discount || 0,
      stock: product?.stock ?? null,
      units: product ? [{ unitId: product.unitId, unitName: product.unitName, factor: 1 }, ...(product.conversions || [])] : [{ unitId: item.unitId || "manual", unitName: item.unitName || "Unidad", factor: 1 }]
    });
  }
}
