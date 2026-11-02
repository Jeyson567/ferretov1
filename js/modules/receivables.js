import { db } from "../firebase-config.js";
import { collection, doc, getDoc, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { can } from "../permissions.js";
import { getMethods } from "../state.js";
import { registerAbono, updateDueDate } from "../operations.js";
import { paymentDocument, printHtml, statementDocument } from "../print.js";
import { balanceText, openWhatsApp, paymentText } from "../whatsapp.js";
import { AGING_LABELS, agingBucket, dateKey, errorMessage, esc, formatDateKey, money, uid } from "../utils.js";
import { confirmDialog, field, openModal, page, table, toast, withBusy } from "../ui.js";

defineRoute("/cxc", { perm: "receivables", title: "Cuentas por cobrar", render: renderReceivables });

async function renderReceivables(root) {
  const load = async () => {
    const snap = await getDocs(query(collection(db, "receivables"), where("status", "in", ["open", "partial", "paid"]), limit(400)));
    const today = dateKey();
    const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status !== "void");
    const open = rows.filter((item) => item.status === "open" || item.status === "partial");
    const owed = open.reduce((sum, item) => sum + Number(item.balance || 0), 0);
    const overdue = open.filter((item) => item.dueDate && item.dueDate < today);
    const aging = { al_dia: 0, "1_30": 0, "31_60": 0, "61_90": 0, mas_90: 0 };
    open.forEach((item) => { aging[agingBucket(item.dueDate, today)] = (aging[agingBucket(item.dueDate, today)] || 0) + Number(item.balance || 0); });
    root.innerHTML = page({
      title: "Cuentas por cobrar",
      subtitle: "Cada abono se guarda por separado y no reemplaza los pagos anteriores.",
      body: `<section class="kpis"><article class="kpi"><span>Total adeudado</span><strong>${money(owed)}</strong></article><article class="kpi"><span>Cuentas vencidas</span><strong>${overdue.length}</strong></article><article class="kpi"><span>Documentos abiertos</span><strong>${open.length}</strong></article></section>
        <section class="kpis">${Object.entries(aging).map(([key, value]) => `<article class="kpi"><span>${AGING_LABELS[key]}</span><strong>${money(value)}</strong></article>`).join("")}</section>
        ${table([
          { label: "Cliente", render: (row) => esc(row.customerName) },
          { label: "Venta", render: (row) => esc(row.saleNumber) },
          { label: "Vence", render: (row) => formatDateKey(row.dueDate) },
          { label: "Original", class: "num", render: (row) => money(row.originalAmount) },
          { label: "Abonado", class: "num", render: (row) => money(row.paidAmount) },
          { label: "Saldo", class: "num", render: (row) => money(row.balance) },
          { label: "Antigüedad", render: (row) => esc(AGING_LABELS[agingBucket(row.dueDate, today)] || "") },
          { label: "", render: (row) => `${row.balance > 0 && (can("receivables.abono") || can("receivables.payFull")) ? `<button class="btn btn-primary" data-pay="${esc(row.id)}" type="button">Abono</button>` : ""} ${can("receivables.statement") ? `<button class="btn btn-ghost" data-statement="${esc(row.id)}" type="button">Estado</button>` : ""} ${can("receivables.whatsapp") ? `<button class="btn btn-gold" data-wa="${esc(row.id)}" type="button">WhatsApp</button>` : ""} ${can("receivables.dueDate") ? `<button class="btn btn-ghost" data-due="${esc(row.id)}" type="button">Vencimiento</button>` : ""}` }
        ], open, "No hay saldos pendientes.")}`
    });
    root.querySelectorAll("[data-pay]").forEach((button) => button.addEventListener("click", () => abonoForm(open.find((item) => item.id === button.dataset.pay), load)));
    root.querySelectorAll("[data-wa]").forEach((button) => button.addEventListener("click", async () => {
      const row = open.find((item) => item.id === button.dataset.wa);
      try {
        const customerSnap = await getDoc(doc(db, "customers", row.customerId));
        openWhatsApp(customerSnap.data()?.whatsapp || customerSnap.data()?.phone, balanceText(row.customerName, row.balance));
      } catch (error) { toast(error.message, "err"); }
    }));
    root.querySelectorAll("[data-due]").forEach((button) => button.addEventListener("click", () => dueForm(open.find((item) => item.id === button.dataset.due), load)));
    root.querySelectorAll("[data-statement]").forEach((button) => button.addEventListener("click", () => printStatement(open.find((item) => item.id === button.dataset.statement))));
  };
  try { await load(); }
  catch (error) { root.innerHTML = page({ title: "Cuentas por cobrar", body: `<div class="banner banner-danger">${esc(errorMessage(error))}</div>` }); }
}

function abonoForm(receivable, reload) {
  const methods = getMethods().filter((item) => item.code !== "credit");
  const modal = openModal({
    title: `Abono de ${receivable.customerName}`,
    content: `<p>Saldo actual <strong>${money(receivable.balance)}</strong> · venta ${esc(receivable.saleNumber)}</p>
      <form id="abono" class="stack">
        ${field({ label: "Monto", name: "amount", type: "number", required: true, attrs: `min="0.01" max="${receivable.balance}" step="0.01"` })}
        ${field({ label: "Método", name: "methodId", type: "select", required: true, options: methods.map((item) => ({ value: item.id, label: item.name })) })}
        ${field({ label: "Referencia", name: "reference" })}
        ${field({ label: "Observaciones", name: "notes", type: "textarea" })}
      </form>`,
    footer: `<button class="btn btn-primary" id="save-abono" type="button">Registrar abono</button>`
  });
  modal.el.querySelector("#save-abono").addEventListener("click", async (event) => {
    const data = Object.fromEntries(new FormData(modal.body.querySelector("#abono")).entries());
    const ok = await confirmDialog({ title: "Registrar abono", message: `Se aplicarán ${money(data.amount)} a la venta ${receivable.saleNumber}.`, confirmText: "Registrar" });
    if (!ok) return;
    await withBusy(event.currentTarget, async () => {
      try {
        const result = await registerAbono({ requestId: uid(), receivableId: receivable.id, ...data });
        toast(result.duplicate ? "Ese abono ya estaba registrado." : "Abono registrado.");
        modal.close();
        const balance = result.balance == null ? Number(receivable.balance) - Number(data.amount) : result.balance;
        const follow = openModal({
          title: "Recibo",
          content: `<p>Saldo pendiente: <strong>${money(balance)}</strong></p>`,
          footer: `${can("receivables.print") ? `<button class="btn btn-primary" id="print-pay" type="button">Imprimir recibo</button>` : ""}${can("receivables.whatsapp") ? `<button class="btn btn-gold" id="wa-pay" type="button">WhatsApp</button>` : ""}`
        });
        follow.el.querySelector("#print-pay")?.addEventListener("click", () => printHtml(paymentDocument(result.payment, balance), "letter"));
        follow.el.querySelector("#wa-pay")?.addEventListener("click", async () => {
          try {
            const customerSnap = await getDoc(doc(db, "customers", receivable.customerId));
            const phone = customerSnap.data()?.whatsapp || customerSnap.data()?.phone;
            openWhatsApp(phone, paymentText(receivable.customerName, result.payment.amount, balance));
          } catch (error) { toast(error.message, "err"); }
        });
        reload();
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
}

function dueForm(receivable, reload) {
  const modal = openModal({
    title: "Fecha de vencimiento",
    size: "sm",
    content: `<form id="due" class="stack">${field({ label: "Nueva fecha", name: "dueDate", type: "date", value: receivable.dueDate || dateKey(), required: true })}</form>`,
    footer: `<button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" id="save-due" type="button">Guardar</button>`
  });
  modal.el.querySelector("#save-due").addEventListener("click", async (event) => {
    await withBusy(event.currentTarget, async () => {
      try {
        await updateDueDate(receivable.id, new FormData(modal.body.querySelector("#due")).get("dueDate"));
        toast("Vencimiento actualizado.");
        modal.close();
        reload();
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
}

async function printStatement(row) {
  const customerSnap = await getDoc(doc(db, "customers", row.customerId));
  if (!customerSnap.exists()) return toast("El cliente no existe.", "err");
  const [receivableSnap, paymentSnap] = await Promise.all([
    getDocs(query(collection(db, "receivables"), where("customerId", "==", row.customerId), limit(80))),
    getDocs(query(collection(db, "payments"), where("customerId", "==", row.customerId), limit(40)))
  ]);
  printHtml(statementDocument(customerSnap.data(), receivableSnap.docs.map((item) => item.data()), paymentSnap.docs.map((item) => item.data())), "letter");
}

export async function printCustomerStatement(customerId) {
  return printStatement({ customerId });
}
