import { db } from "../firebase-config.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { saveCustomer, setCustomerActive } from "../operations.js";
import { printHtml, statementDocument } from "../print.js";
import { balanceText, openWhatsApp } from "../whatsapp.js";
import { badge, confirmDialog, field, openModal, page, pager, readForm, slicePage, table, toast, withBusy } from "../ui.js";
import { errorMessage, esc, money } from "../utils.js";

defineRoute("/clientes", { perm: "customers", title: "Clientes", render: renderCustomers });

export function openCustomerForm(customer = null) {
  return new Promise((resolve) => {
    const modal = openModal({
      title: customer ? "Editar cliente" : "Nuevo cliente",
      content: `<form id="customer-form" class="form-grid">
        ${field({ label: "Nombre o empresa", name: "name", value: customer?.name || "", required: true })}
        ${field({ label: "NIT", name: "nit", value: customer?.nit || "" })}
        ${field({ label: "Teléfono", name: "phone", value: customer?.phone || "", required: true })}
        ${field({ label: "WhatsApp", name: "whatsapp", value: customer?.whatsapp || customer?.phone || "", required: true })}
        ${field({ label: "Correo", name: "email", type: "email", value: customer?.email || "" })}
        ${field({ label: "Dirección", name: "address", value: customer?.address || "" })}
        ${field({ label: "Observaciones", name: "notes", type: "textarea", value: customer?.notes || "" })}
      </form>`,
      footer: `<button class="btn btn-ghost" id="cancel-customer" type="button">Cancelar</button><button class="btn btn-primary" id="save-customer" type="button">Guardar</button>`
    });
    const close = (value) => { modal.close(); resolve(value); };
    modal.el.querySelector("#cancel-customer").addEventListener("click", () => close(null));
    modal.el.querySelector("#save-customer").addEventListener("click", async (event) => {
      await withBusy(event.currentTarget, async () => {
        try {
          const data = readForm(modal.body.querySelector("#customer-form"));
          const id = await saveCustomer({ id: customer?.id, ...data, active: customer?.active !== false });
          toast("Cliente guardado.");
          close({ id, ...data, balance: customer?.balance || 0, active: true });
        } catch (error) { toast(errorMessage(error), "err"); }
      });
    });
  });
}

async function renderCustomers(root, { params }) {
  if (params.get("id")) return renderDetail(root, params.get("id"));
  let pageNo = 1;
  let rows = [];
  const load = async () => {
    const snap = await getDocs(query(collection(db, "customers"), orderBy("nameLower"), limit(400)));
    const term = (root.querySelector("#q")?.value || "").trim().toLowerCase();
    rows = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => !term || `${item.name} ${item.phone} ${item.nit}`.toLowerCase().includes(term));
    const view = slicePage(rows, pageNo, 12);
    pageNo = view.page;
    root.innerHTML = page({
      title: "Clientes",
      subtitle: "Compras, cotizaciones y saldos de cada cliente.",
      actions: `<button class="btn btn-primary" id="new" type="button">Nuevo cliente</button>`,
      body: `<div class="filters"><label class="field"><span>Buscar</span><input id="q" value="${esc(term)}" placeholder="Nombre, teléfono o NIT"></label></div>
        ${table([
          { label: "Cliente", render: (row) => `<a href="#/clientes?id=${esc(row.id)}"><strong>${esc(row.name)}</strong></a>` },
          { label: "Teléfono", render: (row) => esc(row.phone || "—") },
          { label: "NIT", render: (row) => esc(row.nit || "CF") },
          { label: "Saldo", class: "num", render: (row) => money(row.balance || 0) },
          { label: "Estado", render: (row) => badge(row.active === false ? "Inactivo" : "Activo", row.active === false ? "neutral" : "ok") },
          { label: "", render: (row) => `<button class="btn btn-ghost" data-edit="${esc(row.id)}" type="button">Editar</button>` }
        ], view.rows, "Registre el primer cliente.")}
        ${pager(view)}`
    });
    root.querySelector("#q").addEventListener("change", () => { pageNo = 1; load(); });
    root.querySelector("#new").addEventListener("click", async () => { if (await openCustomerForm()) load(); });
    root.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", async () => {
      if (await openCustomerForm(rows.find((item) => item.id === button.dataset.edit))) load();
    }));
    root.querySelector("[data-page=prev]")?.addEventListener("click", () => { pageNo -= 1; paintPage(); });
    root.querySelector("[data-page=next]")?.addEventListener("click", () => { pageNo += 1; paintPage(); });
    function paintPage() { load(); }
  };
  try { await load(); }
  catch (error) { root.innerHTML = page({ title: "Clientes", body: `<div class="banner banner-danger">${esc(errorMessage(error))}</div>` }); }
}

async function renderDetail(root, id) {
  const snap = await getDoc(doc(db, "customers", id));
  if (!snap.exists()) {
    root.innerHTML = page({ title: "Cliente", body: `<div class="banner banner-danger">El cliente no existe.</div>` });
    return;
  }
  const customer = { id: snap.id, ...snap.data() };
  const [salesSnap, quotesSnap, receivableSnap, paymentSnap] = await Promise.all([
    getDocs(query(collection(db, "sales"), where("customerId", "==", id), limit(50))),
    getDocs(query(collection(db, "quotes"), where("customerId", "==", id), limit(50))),
    getDocs(query(collection(db, "receivables"), where("customerId", "==", id), limit(50))),
    getDocs(query(collection(db, "payments"), where("customerId", "==", id), limit(50)))
  ]);
  const sales = salesSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.at || 0) - (a.at || 0));
  const quotes = quotesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const receivables = receivableSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const payments = paymentSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.at || 0) - (a.at || 0));
  const balance = receivables.filter((item) => item.status !== "paid" && item.status !== "void").reduce((sum, item) => sum + Number(item.balance || 0), 0);
  root.innerHTML = page({
    title: esc(customer.name),
    subtitle: `${customer.phone || ""} · Saldo ${money(balance)}`,
    actions: `<a class="btn btn-ghost" href="#/clientes">Volver</a><button class="btn btn-primary" id="edit" type="button">Editar</button><button class="btn btn-ghost" id="statement" type="button">Estado de cuenta</button><button class="btn btn-gold" id="wa" type="button">WhatsApp</button><button class="btn btn-ghost" id="off" type="button">${customer.active === false ? "Activar" : "Desactivar"}</button>`,
    body: `<section class="kpis">${kpi("Saldo", money(balance))}${kpi("Compras", sales.length)}${kpi("Cotizaciones", quotes.length)}${kpi("Último pago", payments[0] ? money(payments[0].amount) : "—")}</section>
      <article class="card"><h2>Compras</h2>${mini(sales, (row) => `<a href="#/ventas?id=${esc(row.id)}">${esc(row.number)}</a> · ${money(row.total)}`)}</article>
      <article class="card"><h2>Cotizaciones</h2>${mini(quotes, (row) => `<a href="#/cotizaciones?id=${esc(row.id)}">${esc(row.number)}</a> · ${money(row.total)}`)}</article>
      <article class="card"><h2>Cuentas</h2>${mini(receivables, (row) => `${esc(row.saleNumber)} · saldo ${money(row.balance)} · vence ${esc(row.dueDate || "—")}`)}</article>
      <article class="card"><h2>Abonos</h2>${mini(payments.filter((item) => item.type === "abono"), (row) => `${esc(row.number || "Abono")} · ${money(row.amount)}`)}</article>`
  });
  root.querySelector("#edit").addEventListener("click", async () => { if (await openCustomerForm(customer)) renderDetail(root, id); });
  root.querySelector("#statement").addEventListener("click", () => printHtml(statementDocument(customer, receivables, payments), "letter"));
  root.querySelector("#wa").addEventListener("click", () => {
    try { openWhatsApp(customer.whatsapp || customer.phone, balanceText(customer.name, balance)); }
    catch (error) { toast(error.message, "err"); }
  });
  root.querySelector("#off").addEventListener("click", async () => {
    const active = customer.active === false;
    const ok = await confirmDialog({ title: active ? "Activar cliente" : "Desactivar cliente", message: "El historial se conserva.", danger: !active });
    if (!ok) return;
    try { await setCustomerActive(id, active); toast("Cliente actualizado."); renderDetail(root, id); }
    catch (error) { toast(errorMessage(error), "err"); }
  });
}

function kpi(label, value) { return `<article class="kpi"><span>${label}</span><strong>${value}</strong></article>`; }
function mini(rows, render) {
  if (!rows.length) return `<p class="help">Sin registros.</p>`;
  return rows.slice(0, 8).map((row) => `<p>${render(row)}</p>`).join("");
}
