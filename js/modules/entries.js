import { db } from "../firebase-config.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { readByDate } from "../lists.js";
import { createStockEntry } from "../operations.js";
import { mountProductSearch } from "../pickers.js";
import { dateKey, errorMessage, esc, formatDateKey, money, monthRange, qty, uid } from "../utils.js";
import { openModal, page, table, toast, withBusy } from "../ui.js";

defineRoute("/entradas", { perm: "entries", title: "Entradas de inventario", render: renderEntries });

async function renderEntries(root) {
  const month = monthRange(dateKey());
  const load = async () => {
    const rows = await readByDate("stockEntries", month.start, dateKey(), 100);
    const suppliers = (await getDocs(query(collection(db, "suppliers"), orderBy("nameLower"), limit(200)))).docs.map((item) => ({ id: item.id, ...item.data() }));
    root.innerHTML = page({
      title: "Entradas de inventario",
      subtitle: "Compras y reposiciones. No son ventas.",
      actions: `<button class="btn btn-primary" id="new" type="button">Nueva entrada</button>`,
      body: table([
        { label: "Número", render: (row) => esc(row.number) },
        { label: "Fecha", render: (row) => formatDateKey(row.dateKey) },
        { label: "Proveedor", render: (row) => esc(row.supplierName) },
        { label: "Referencia", render: (row) => esc(row.reference || "—") },
        { label: "Total", class: "num", render: (row) => money(row.total) },
        { label: "", render: (row) => `<button class="btn btn-ghost" data-see="${row.id}" type="button">Detalle</button>` }
      ], rows, "No hay entradas este mes.")
    });
    root.querySelector("#new").addEventListener("click", () => entryForm(suppliers, load));
    root.querySelectorAll("[data-see]").forEach((button) => button.addEventListener("click", () => {
      const entry = rows.find((item) => item.id === button.dataset.see);
      openModal({ title: entry.number, size: "lg", content: table([
        { label: "Producto", render: (row) => esc(row.name) },
        { label: "Cantidad", render: (row) => `${qty(row.qty)} ${esc(row.unitName || "")}` },
        { label: "Costo", class: "num", render: (row) => money(row.cost) },
        { label: "Total", class: "num", render: (row) => money(row.lineTotal) }
      ], entry.items || []) });
    }));
  };
  try { await load(); }
  catch (error) { root.innerHTML = page({ title: "Entradas de inventario", body: `<div class="banner banner-danger">${esc(errorMessage(error))}</div>` }); }
}

function entryForm(suppliers, reload) {
  const lines = [];
  let requestId = uid();
  const modal = openModal({
    title: "Nueva entrada",
    size: "lg",
    content: `<div class="stack"><label class="field"><span>Proveedor</span><select id="supplier"><option value="">Sin proveedor</option>${suppliers.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Fecha</span><input id="date" type="date" value="${dateKey()}"></label>
      <label class="field"><span>Referencia</span><input id="reference" placeholder="Factura o envío"></label>
      <label class="field"><span>Producto</span><input id="find" placeholder="Buscar producto"></label><div id="menu" class="suggest" hidden></div>
      <div id="lines"></div>
      <label class="check"><input id="main" type="checkbox"> Marcar este proveedor como principal de los productos</label>
      <label class="field"><span>Observaciones</span><textarea id="notes"></textarea></label></div>`,
    footer: `<button class="btn btn-primary" id="save" type="button">Registrar entrada</button>`
  });
  const paint = () => {
    modal.body.querySelector("#lines").innerHTML = lines.map((line, index) => `<div class="form-grid"><strong>${esc(line.name)}</strong><input data-qty="${index}" type="number" min="0.001" step="0.001" value="${line.qty}"><input data-cost="${index}" type="number" min="0" step="0.01" value="${line.cost}"><button data-remove="${index}" type="button">Quitar</button></div>`).join("") || `<p class="help">Agregue productos. La cantidad y el costo son de la unidad base.</p>`;
    modal.body.querySelectorAll("[data-qty]").forEach((input) => input.addEventListener("input", () => { lines[input.dataset.qty].qty = Number(input.value); }));
    modal.body.querySelectorAll("[data-cost]").forEach((input) => input.addEventListener("input", () => { lines[input.dataset.cost].cost = Number(input.value); }));
    modal.body.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { lines.splice(Number(button.dataset.remove), 1); paint(); }));
  };
  mountProductSearch(modal.body.querySelector("#find"), modal.body.querySelector("#menu"), (product) => {
    lines.push({ productId: product.id, name: product.name, qty: 1, cost: product.cost || 0 });
    paint();
  });
  paint();
  modal.el.querySelector("#save").addEventListener("click", async (event) => {
    const supplier = suppliers.find((item) => item.id === modal.body.querySelector("#supplier").value);
    await withBusy(event.currentTarget, async () => {
      try {
        await createStockEntry({
          requestId,
          supplierId: supplier?.id || "",
          supplierName: supplier?.name || "",
          dateKey: modal.body.querySelector("#date").value,
          reference: modal.body.querySelector("#reference").value,
          notes: modal.body.querySelector("#notes").value,
          setAsMainSupplier: modal.body.querySelector("#main").checked,
          items: lines
        });
        toast("Entrada registrada. El costo promedio y las existencias fueron actualizados.");
        modal.close();
        reload();
      } catch (error) {
        toast(errorMessage(error), "err");
      }
    });
  });
}
