import { db } from "../firebase-config.js";
import { collection, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { saveSupplier, setSupplierActive } from "../operations.js";
import { openWhatsApp } from "../whatsapp.js";
import { badge, confirmDialog, field, openModal, page, readForm, table, toast, withBusy } from "../ui.js";
import { errorMessage, esc, money } from "../utils.js";

defineRoute("/proveedores", { perm: "suppliers", title: "Proveedores", render: renderSuppliers });

async function renderSuppliers(root) {
  const load = async () => {
    const snap = await getDocs(query(collection(db, "suppliers"), orderBy("nameLower"), limit(300)));
    const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    root.innerHTML = page({
      title: "Proveedores",
      subtitle: "Contactos y entradas de inventario asociadas.",
      actions: `<button class="btn btn-primary" id="new" type="button">Nuevo proveedor</button>`,
      body: table([
        { label: "Proveedor", render: (row) => `<strong>${esc(row.name)}</strong><div class="line-note">${esc(row.company || "")}</div>` },
        { label: "NIT", render: (row) => esc(row.nit || "—") },
        { label: "Teléfono", render: (row) => esc(row.phone || "—") },
        { label: "Contacto", render: (row) => esc(row.contactName || "—") },
        { label: "Estado", render: (row) => badge(row.active === false ? "Inactivo" : "Activo", row.active === false ? "neutral" : "ok") },
        { label: "", render: (row) => `<button class="btn btn-ghost" data-edit="${row.id}" type="button">Editar</button> <button class="btn btn-ghost" data-see="${row.id}" type="button">Ver</button>` }
      ], rows, "Registre el primer proveedor.")
    });
    root.querySelector("#new").addEventListener("click", () => form(null, load));
    root.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => form(rows.find((item) => item.id === button.dataset.edit), load)));
    root.querySelectorAll("[data-see]").forEach((button) => button.addEventListener("click", () => detail(rows.find((item) => item.id === button.dataset.see))));
  };
  try { await load(); }
  catch (error) { root.innerHTML = page({ title: "Proveedores", body: `<div class="banner banner-danger">${esc(errorMessage(error))}</div>` }); }
}

function form(supplier, reload) {
  const modal = openModal({
    title: supplier ? "Editar proveedor" : "Nuevo proveedor",
    content: `<form id="supplier" class="form-grid">
      ${field({ label: "Nombre", name: "name", value: supplier?.name || "", required: true })}
      ${field({ label: "Empresa", name: "company", value: supplier?.company || "" })}
      ${field({ label: "NIT", name: "nit", value: supplier?.nit || "" })}
      ${field({ label: "Teléfono", name: "phone", value: supplier?.phone || "" })}
      ${field({ label: "WhatsApp", name: "whatsapp", value: supplier?.whatsapp || "" })}
      ${field({ label: "Correo", name: "email", value: supplier?.email || "" })}
      ${field({ label: "Contacto principal", name: "contactName", value: supplier?.contactName || "" })}
      ${field({ label: "Dirección", name: "address", value: supplier?.address || "" })}
      ${field({ label: "Observaciones", name: "notes", type: "textarea", value: supplier?.notes || "" })}
    </form>`,
    footer: `<button class="btn btn-primary" id="save" type="button">Guardar</button>${supplier ? `<button class="btn btn-ghost" id="off" type="button">${supplier.active === false ? "Activar" : "Desactivar"}</button>` : ""}`
  });
  modal.el.querySelector("#save").addEventListener("click", async (event) => {
    await withBusy(event.currentTarget, async () => {
      try {
        await saveSupplier({ id: supplier?.id, ...readForm(modal.body.querySelector("#supplier")), active: supplier?.active !== false });
        toast("Proveedor guardado.");
        modal.close();
        reload();
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
  modal.el.querySelector("#off")?.addEventListener("click", async () => {
    const active = supplier.active === false;
    const ok = await confirmDialog({ title: "Cambiar estado", message: "El historial de entradas se conserva.", danger: !active });
    if (!ok) return;
    try { await setSupplierActive(supplier.id, active); toast("Estado actualizado."); modal.close(); reload(); }
    catch (error) { toast(errorMessage(error), "err"); }
  });
}

async function detail(supplier) {
  const [products, entries] = await Promise.all([
    getDocs(query(collection(db, "products"), where("supplierId", "==", supplier.id), limit(50))),
    getDocs(query(collection(db, "stockEntries"), where("supplierId", "==", supplier.id), limit(30)))
  ]);
  const modal = openModal({
    title: supplier.name,
    size: "lg",
    content: `<p>${esc(supplier.company || "")} · ${esc(supplier.phone || "")} · ${esc(supplier.address || "")}</p>
      <h3>Productos relacionados</h3>
      ${products.docs.map((item) => `<p>${esc(item.data().name)} · existencia ${item.data().stock}</p>`).join("") || "<p class='help'>Sin productos ligados.</p>"}
      <h3>Entradas</h3>
      ${entries.docs.map((item) => `<p>${esc(item.data().number)} · ${money(item.data().total)} · ${esc(item.data().reference || "")}</p>`).join("") || "<p class='help'>Sin entradas.</p>"}`,
    footer: supplier.whatsapp || supplier.phone ? `<button class="btn btn-gold" id="wa" type="button">WhatsApp</button>` : ""
  });
  modal.el.querySelector("#wa")?.addEventListener("click", () => {
    try { openWhatsApp(supplier.whatsapp || supplier.phone, `Hola, ${supplier.contactName || supplier.name}. Le escribimos de FERRETOV.`); }
    catch (error) { toast(error.message, "err"); }
  });
}
