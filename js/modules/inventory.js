import { db } from "../firebase-config.js";
import { collection, doc, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { can } from "../permissions.js";
import { searchProducts } from "../pickers.js";
import { getCategories, getSettings, getUnits, loadCatalogs } from "../state.js";
import { adjustStock, saveCatalogItem, saveProduct, setProductActive } from "../operations.js";
import { askText, badge, confirmDialog, emptyState, field, openModal, page, pager, readForm, slicePage, table, toast, withBusy } from "../ui.js";
import { errorMessage, esc, money, qty, roundQty } from "../utils.js";

defineRoute("/inventario", { perm: "products.read", title: "Inventario", render: renderInventory });

async function renderInventory(root) {
  const canCreate = can("inventory.create");
  const canEdit = can("inventory.edit");
  const canAdjustIn = can("inventory.increaseStock");
  const canAdjustOut = can("inventory.decreaseStock");
  const canDisable = can("inventory.delete");
  const canHistory = can("inventory.movements");
  const canCost = can("inventory.viewCosts");
  const canPrice = can("inventory.viewPrices");
  let rows = [];
  let pageNo = 1;
  let search = "";
  let category = "";
  let stock = "";
  const load = async () => {
    root.innerHTML = page({ title: "Inventario", subtitle: "Existencias, precios y unidades de la ferretería.", body: `<div class="loading-block"><span class="spinner"></span> Cargando productos…</div>` });
    try {
      if (search.trim().length >= 2) rows = await searchProducts(search.trim());
      else {
        const snap = await getDocs(query(collection(db, "products"), orderBy("nameLower"), limit(300)));
        rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      }
      rows = rows.filter((item) => !category || item.categoryId === category)
        .filter((item) => stock !== "low" || item.lowStock)
        .filter((item) => stock !== "out" || item.outOfStock)
        .filter((item) => stock !== "off" || item.active === false);
      paint();
    } catch (error) {
      root.innerHTML = page({ title: "Inventario", body: `<div class="banner banner-danger">${esc(errorMessage(error))}</div>` });
    }
  };
  const paint = () => {
    const view = slicePage(rows, pageNo, 12);
    pageNo = view.page;
    const categories = getCategories();
    root.innerHTML = page({
      title: "Inventario",
      subtitle: rows.length >= 300 && !search ? "Mostrando los primeros 300 productos. Use el buscador para encontrar el resto." : "Busque por nombre, código o código de barras.",
      actions: canCreate ? `<button class="btn btn-primary" id="new-product" type="button">Nuevo producto</button>` : "",
      body: `<div class="filters">
          <label class="field"><span>Buscar</span><input id="q" value="${esc(search)}" placeholder="Nombre, código o barras"></label>
          <label class="field"><span>Categoría</span><select id="cat"><option value="">Todas</option>${categories.map((item) => `<option value="${esc(item.id)}" ${item.id === category ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Existencia</span><select id="stock">
            <option value="" ${stock === "" ? "selected" : ""}>Todas</option>
            <option value="low" ${stock === "low" ? "selected" : ""}>Bajas</option>
            <option value="out" ${stock === "out" ? "selected" : ""}>Agotadas</option>
            <option value="off" ${stock === "off" ? "selected" : ""}>Inactivas</option>
          </select></label>
        </div>
        ${table(columns(), view.rows, "No hay productos con ese filtro.")}
        ${pager(view)}`
    });
    root.querySelector("#q").addEventListener("change", (event) => { search = event.target.value; pageNo = 1; load(); });
    root.querySelector("#cat").addEventListener("change", (event) => { category = event.target.value; pageNo = 1; load(); });
    root.querySelector("#stock").addEventListener("change", (event) => { stock = event.target.value; pageNo = 1; load(); });
    root.querySelector("[data-page=prev]")?.addEventListener("click", () => { pageNo -= 1; paint(); });
    root.querySelector("[data-page=next]")?.addEventListener("click", () => { pageNo += 1; paint(); });
    root.querySelector("#new-product")?.addEventListener("click", () => productForm(null, load));
    root.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => productForm(rows.find((item) => item.id === button.dataset.edit), load)));
    root.querySelectorAll("[data-adjust]").forEach((button) => button.addEventListener("click", () => adjustForm(rows.find((item) => item.id === button.dataset.adjust), load)));
    root.querySelectorAll("[data-history]").forEach((button) => button.addEventListener("click", () => history(button.dataset.history)));
    root.querySelectorAll("[data-off]").forEach((button) => button.addEventListener("click", async () => {
      const product = rows.find((item) => item.id === button.dataset.off);
      const off = product.active !== false;
      const ok = await confirmDialog({ title: off ? "Desactivar producto" : "Activar producto", message: off ? "El producto dejará de aparecer en ventas. Su historial se conserva." : "El producto volverá a estar disponible.", danger: off });
      if (!ok) return;
      try { await setProductActive(product.id, !off); toast(off ? "Producto desactivado." : "Producto activado."); load(); }
      catch (error) { toast(errorMessage(error), "err"); }
    }));
  };
  function columns() {
    const cols = [
      { label: "Código", render: (row) => esc(row.code) },
      { label: "Producto", render: (row) => `<strong>${esc(row.name)}</strong><div class="line-note">${esc(row.brand || row.categoryName || "")}</div>` },
      { label: "Existencia", render: (row) => `${qty(row.stock)} ${esc(row.unitName || "")} ${row.outOfStock ? badge("Agotado", "danger") : row.lowStock ? badge("Bajo", "warn") : ""}` }
    ];
    if (canPrice) cols.push({ label: "Precio", class: "num", render: (row) => money(row.price) });
    if (canCost) cols.push({ label: "Costo", class: "num", render: (row) => money(row.cost) });
    cols.push({ label: "Estado", render: (row) => badge(row.active === false ? "Inactivo" : "Activo", row.active === false ? "neutral" : "ok") });
    cols.push({ label: "Acciones", render: (row) => `<div class="inline-actions">${canEdit ? `<button class="btn btn-ghost" data-edit="${esc(row.id)}" type="button">Editar</button>` : ""}${canAdjustIn || canAdjustOut ? `<button class="btn btn-ghost" data-adjust="${esc(row.id)}" type="button">Ajustar</button>` : ""}${canDisable ? `<button class="btn btn-ghost" data-off="${esc(row.id)}" type="button">${row.active === false ? "Activar" : "Desactivar"}</button>` : ""}${canHistory ? `<button class="btn btn-ghost" data-history="${esc(row.id)}" type="button">Historial</button>` : ""}</div>` });
    return cols;
  }
  await load();
}

async function suppliers() {
  if (!can("suppliers") && !can("products")) return [];
  try {
    const snap = await getDocs(query(collection(db, "suppliers"), orderBy("nameLower"), limit(200)));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.active !== false);
  } catch { return []; }
}

async function productForm(product, reload) {
  const units = getUnits();
  const categories = getCategories();
  const providerList = await suppliers();
  const modal = openModal({
    title: product ? "Editar producto" : "Nuevo producto",
    size: "lg",
    content: `<form id="product-form" class="form-grid">
      ${field({ label: "Código", name: "code", value: product?.code || "", required: true })}
      ${field({ label: "Código de barras", name: "barcode", value: product?.barcode || "" })}
      ${field({ label: "Nombre", name: "name", value: product?.name || "", required: true, attrs: "class='span-2'" })}
      ${field({ label: "Descripción", name: "description", type: "textarea", value: product?.description || "" })}
      ${field({ label: "Marca", name: "brand", value: product?.brand || "" })}
      <label class="field"><span>Categoría</span><select name="categoryId"><option value="">Sin categoría</option>${categories.map((item) => `<option value="${esc(item.id)}" ${item.id === product?.categoryId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
      <label class="field req"><span>Unidad base de inventario</span><select name="unitId" required><option value="">Seleccione</option>${units.map((item) => `<option value="${esc(item.id)}" ${item.id === product?.unitId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
      ${can("inventory.viewCosts") ? field({ label: "Costo", name: "cost", type: "number", value: product?.cost ?? "", required: true, attrs: 'min="0" step="0.01"' }) : ""}
      ${can("inventory.viewPrices") ? field({ label: "Precio de venta", name: "price", type: "number", value: product?.price ?? "", required: true, attrs: 'min="0" step="0.01"' }) : ""}
      ${field({ label: "Precio mayorista", name: "wholesalePrice", type: "number", value: product?.wholesalePrice ?? "", attrs: 'min="0" step="0.01"' })}
      ${product ? `<label class="field"><span>Existencia actual</span><input value="${qty(product.stock)} ${esc(product.unitName || "")}" disabled></label>` : field({ label: "Existencia inicial", name: "stock", type: "number", value: "0", attrs: 'min="0" step="0.001"' })}
      ${field({ label: "Existencia mínima", name: "minStock", type: "number", value: product?.minStock ?? getSettings().defaultMinStock ?? 5, attrs: 'min="0" step="0.001"' })}
      <label class="field"><span>Proveedor principal</span><select name="supplierId"><option value="">Sin proveedor</option>${providerList.map((item) => `<option value="${esc(item.id)}" ${item.id === product?.supplierId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Imagen</span><input name="image" type="file" accept="image/*"></label>
      <div class="span-2"><strong>Conversiones de venta</strong><p class="help">Si vende el producto en otra unidad, indique cuántas unidades base representa. Ejemplo: 1 saco = 100 libras.</p><div id="conversions"></div><button class="btn btn-ghost" id="add-conv" type="button">Agregar unidad de venta</button></div>
      <div class="span-2 inline-actions"><button class="linkish" id="add-cat" type="button">Nueva categoría</button><button class="linkish" id="add-unit" type="button">Nueva unidad</button></div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" id="save-product" type="button">Guardar producto</button>`
  });
  const host = modal.body.querySelector("#conversions");
  const conversions = [...(product?.conversions || [])];
  const paintConv = () => {
    host.innerHTML = conversions.map((item, index) => `<div class="conv-row"><select data-unit="${index}">${units.map((unit) => `<option value="${esc(unit.id)}" ${unit.id === item.unitId ? "selected" : ""}>${esc(unit.name)}</option>`).join("")}</select><input data-factor="${index}" type="number" min="0.001" step="0.001" value="${item.factor || ""}" placeholder="Factor"><span class="help">unidades base</span><button type="button" data-del="${index}">Quitar</button></div>`).join("") || `<p class="help">Sin conversiones. Se vende en la unidad base.</p>`;
  };
  paintConv();
  modal.body.querySelector("#add-conv").addEventListener("click", () => { conversions.push({ unitId: units[0]?.id || "", factor: 1 }); paintConv(); });
  host.addEventListener("click", (event) => {
    const button = event.target.closest("[data-del]");
    if (!button) return;
    conversions.splice(Number(button.dataset.del), 1);
    paintConv();
  });
  host.addEventListener("change", (event) => {
    const unit = event.target.dataset.unit;
    const factor = event.target.dataset.factor;
    if (unit != null) conversions[Number(unit)].unitId = event.target.value;
    if (factor != null) conversions[Number(factor)].factor = event.target.value;
  });
  modal.body.querySelector("#add-cat").addEventListener("click", () => quickCatalog("categories", "Nueva categoría", reload));
  modal.body.querySelector("#add-unit").addEventListener("click", () => quickCatalog("units", "Nueva unidad", reload));
  modal.el.querySelector("#save-product").addEventListener("click", async (event) => {
    await withBusy(event.currentTarget, async () => {
      try {
        const form = modal.body.querySelector("#product-form");
        const data = readForm(form);
        const unit = units.find((item) => item.id === data.unitId);
        const category = categories.find((item) => item.id === data.categoryId);
        const supplier = providerList.find((item) => item.id === data.supplierId);
        const file = form.image.files[0];
        await saveProduct({
          id: product?.id,
          ...data,
          unitName: unit?.name || "",
          categoryName: category?.name || "",
          supplierName: supplier?.name || "",
          conversions: conversions.filter((item) => item.unitId && Number(item.factor) > 0).map((item) => ({
            unitId: item.unitId,
            unitName: units.find((unitItem) => unitItem.id === item.unitId)?.name || item.unitName,
            factor: roundQty(item.factor)
          }))
        }, file);
        toast("Producto guardado.");
        modal.close();
        await loadCatalogs();
        reload();
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
}

async function quickCatalog(collectionName, title, reload) {
  const name = await askText({ title, label: "Nombre", confirmText: "Guardar" });
  if (!name) return;
  try {
    await saveCatalogItem(collectionName, null, { name: name.trim(), symbol: name.trim(), active: true });
    await loadCatalogs();
    toast("Catálogo actualizado. Vuelva a abrir el formulario para verlo.");
    reload();
  } catch (error) { toast(errorMessage(error), "err"); }
}

function adjustForm(product, reload) {
  const modal = openModal({
    title: `Ajustar ${product.name}`,
    size: "sm",
    content: `<form id="adjust-form" class="stack">
      <p>Existencia actual: <strong>${qty(product.stock)} ${esc(product.unitName || "")}</strong></p>
      ${field({ label: "Tipo", name: "direction", type: "select", value: can("inventory.increaseStock") ? "in" : "out", options: [
        can("inventory.increaseStock") ? { value: "in", label: "Aumentar" } : null,
        can("inventory.decreaseStock") ? { value: "out", label: "Disminuir" } : null
      ].filter(Boolean) })}
      ${field({ label: "Cantidad", name: "qty", type: "number", required: true, attrs: 'min="0.001" step="0.001"' })}
      ${field({ label: "Motivo", name: "reason", type: "textarea", required: true })}
    </form>`,
    footer: `<button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" id="save-adjust" type="button">Registrar ajuste</button>`
  });
  modal.el.querySelector("#save-adjust").addEventListener("click", async (event) => {
    const data = readForm(modal.body.querySelector("#adjust-form"));
    const ok = await confirmDialog({ title: "Confirmar ajuste", message: "Este movimiento quedará en el historial y en la auditoría.", confirmText: "Ajustar" });
    if (!ok) return;
    await withBusy(event.currentTarget, async () => {
      try {
        await adjustStock({ productId: product.id, qty: data.qty, direction: data.direction, reason: data.reason });
        toast("Existencia actualizada.");
        modal.close();
        reload();
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
}

async function history(productId) {
  const modal = openModal({ title: "Historial de movimientos", size: "lg", content: `<div class="loading-block"><span class="spinner"></span></div>` });
  try {
    const snap = await getDocs(query(collection(db, "inventoryMovements"), where("productId", "==", productId), limit(50)));
    const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.at || 0) - (a.at || 0));
    modal.body.innerHTML = table([
      { label: "Fecha", render: (row) => esc(row.dateKey || "") },
      { label: "Tipo", render: (row) => esc(row.type) },
      { label: "Cantidad", class: "num", render: (row) => qty(row.quantity) },
      { label: "Saldo", class: "num", render: (row) => qty(row.newStock) },
      { label: "Motivo", render: (row) => esc(row.reason || "") },
      { label: "Referencia", render: (row) => esc(row.referenceNumber || "") },
      { label: "Usuario", render: (row) => esc(row.userName || "") }
    ], rows, "Este producto todavía no tiene movimientos.");
  } catch (error) { modal.body.innerHTML = `<div class="banner banner-danger">${esc(errorMessage(error))}</div>`; }
}
