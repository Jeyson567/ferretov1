import { defineRoute } from "../router.js";
import { can } from "../permissions.js";
import { getExpenseCategories, getMethods } from "../state.js";
import { readByDate } from "../lists.js";
import { saveExpense, voidExpense } from "../operations.js";
import { askText, confirmDialog, field, openModal, page, readForm, table, toast, withBusy } from "../ui.js";
import { dateKey, errorMessage, esc, formatDateKey, money, monthRange, uid } from "../utils.js";

defineRoute("/gastos", { perm: "expenses", title: "Gastos", render: renderExpenses });

async function renderExpenses(root) {
  const month = monthRange(dateKey());
  let from = month.start;
  let to = dateKey();
  const load = async () => {
    const rows = (await readByDate("expenses", from, to, 300)).sort((a, b) => (b.at || 0) - (a.at || 0));
    const active = rows.filter((row) => row.status !== "void");
    const total = active.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    root.innerHTML = page({
      title: "Gastos",
      subtitle: `Total del período ${money(total)}. Los anulados permanecen en el historial.`,
      actions: can("expenses.create") ? `<button class="btn btn-primary" id="new" type="button">Registrar gasto</button>` : "",
      body: `<div class="filters"><label class="field"><span>Desde</span><input id="from" type="date" value="${from}"></label><label class="field"><span>Hasta</span><input id="to" type="date" value="${to}"></label><button class="btn btn-ghost" id="apply" type="button">Consultar</button></div>
        ${table([
          { label: "Número", render: (row) => esc(row.number) },
          { label: "Fecha", render: (row) => formatDateKey(row.dateKey) },
          { label: "Descripción", render: (row) => esc(row.description) },
          { label: "Categoría", render: (row) => esc(row.categoryName) },
          { label: "Método", render: (row) => esc(row.paymentMethodName) },
          { label: "Monto", class: "num", render: (row) => money(row.amount) },
          { label: "Estado", render: (row) => row.status === "void" ? "Anulado" : "Activo" },
          { label: "", render: (row) => row.status === "void" ? "" : `${can("expenses.edit") ? `<button class="btn btn-ghost" data-edit="${row.id}" type="button">Editar</button>` : ""} ${can("expenses.void") ? `<button class="btn btn-danger" data-void="${row.id}" type="button">Anular</button>` : ""}` }
        ], rows, "No hay gastos en el período.")}`
    });
    root.querySelector("#apply").addEventListener("click", () => { from = root.querySelector("#from").value; to = root.querySelector("#to").value; load(); });
    root.querySelector("#new")?.addEventListener("click", () => form(null, load));
    root.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => form(rows.find((row) => row.id === button.dataset.edit), load)));
    root.querySelectorAll("[data-void]").forEach((button) => button.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Anular gasto", message: "El gasto dejará de sumar en los reportes y quedará registrado.", danger: true, confirmText: "Anular" });
      if (!ok) return;
      const reason = await askText({ title: "Anular gasto", label: "Motivo", confirmText: "Anular" });
      if (!reason) return;
      try { await voidExpense(button.dataset.void, reason); toast("Gasto anulado."); load(); }
      catch (error) { toast(errorMessage(error), "err"); }
    }));
  };
  await load();
}

function form(expense, reload) {
  const categories = getExpenseCategories();
  const methods = getMethods().filter((item) => item.code !== "credit");
  const modal = openModal({
    title: expense ? "Editar gasto" : "Nuevo gasto",
    content: `<form id="expense" class="stack">
      ${field({ label: "Descripción", name: "description", value: expense?.description || "", required: true })}
      ${field({ label: "Categoría", name: "categoryId", type: "select", value: expense?.categoryId || "", options: categories.map((item) => ({ value: item.id, label: item.name })) })}
      ${field({ label: "Monto", name: "amount", type: "number", value: expense?.amount || "", required: true, attrs: 'min="0.01" step="0.01"' })}
      ${field({ label: "Fecha", name: "dateKey", type: "date", value: expense?.dateKey || dateKey(), required: true })}
      ${field({ label: "Método de pago", name: "paymentMethodId", type: "select", value: expense?.paymentMethodId || "", options: methods.map((item) => ({ value: item.id, label: item.name })) })}
      ${field({ label: "Observaciones", name: "notes", type: "textarea", value: expense?.notes || "" })}
      ${expense ? `<p class="help">La modificación queda en la auditoría.</p>` : ""}
    </form>`,
    footer: `<button class="btn btn-primary" id="save" type="button">Guardar</button>`
  });
  modal.el.querySelector("#save").addEventListener("click", async (event) => {
    if (expense) {
      const ok = await confirmDialog({ title: "Editar gasto", message: "Esta modificación quedará en la auditoría.", confirmText: "Guardar" });
      if (!ok) return;
    }
    const data = readForm(modal.body.querySelector("#expense"));
    const category = categories.find((item) => item.id === data.categoryId);
    const method = methods.find((item) => item.id === data.paymentMethodId);
    await withBusy(event.currentTarget, async () => {
      try {
        await saveExpense({ id: expense?.id, ...data, categoryName: category?.name || "Otros", paymentMethodName: method?.name || "" });
        toast("Gasto guardado.");
        modal.close();
        reload();
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
}
