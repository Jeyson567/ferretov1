import { db } from "../firebase-config.js";
import { collection, doc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_METHODS, DEFAULT_UNITS } from "../defaults.js";
import { exportBackup, saveCatalogItem, saveSettings } from "../operations.js";
import { getCategories, getExpenseCategories, getMethods, getSettings, getUnits, loadCatalogs } from "../state.js";
import { can } from "../permissions.js";
import { THEME_PRESETS, applyTheme } from "../theme.js";
import { downloadJson, errorMessage, esc } from "../utils.js";
import { askText, field, openModal, page, readForm, toast, withBusy } from "../ui.js";

defineRoute("/configuracion", { perm: "settings", title: "Configuración", render: renderSettings });

async function renderSettings(root) {
  const settings = getSettings();
  root.innerHTML = page({
    title: "Configuración",
    subtitle: "Guatemala · Quetzales · America/Guatemala · fechas DD/MM/AAAA.",
    body: `${themeCard(settings)}
    <form id="settings" class="card form-grid">
      ${field({ label: "Nombre del negocio", name: "businessName", value: settings.businessName || "", required: true })}
      ${field({ label: "NIT", name: "nit", value: settings.nit || "" })}
      ${field({ label: "Teléfono", name: "phone", value: settings.phone || "" })}
      ${field({ label: "WhatsApp", name: "whatsapp", value: settings.whatsapp || "" })}
      ${field({ label: "Dirección", name: "address", value: settings.address || "" })}
      ${field({ label: "Correo del negocio", name: "email", type: "email", value: settings.email || "" })}
      ${field({ label: "Texto al pie del comprobante", name: "ticketFooter", value: settings.ticketFooter || "" })}
      ${field({ label: "Existencia mínima sugerida", name: "defaultMinStock", type: "number", value: settings.defaultMinStock ?? 5, attrs: 'min="0" step="1"' })}
      ${field({ label: "Descuento máximo del vendedor (%)", name: "maxDiscountPercent", type: "number", value: settings.maxDiscountPercent ?? 15, attrs: 'min="0" step="1"' })}
      <label class="field"><span>Formato de impresión preferido</span><select name="printFormat"><option value="letter" ${settings.printFormat !== "ticket" ? "selected" : ""}>Carta</option><option value="ticket" ${settings.printFormat === "ticket" ? "selected" : ""}>Ticket</option></select></label>
      <label class="check"><input name="allowNegativeStock" type="checkbox" ${settings.allowNegativeStock ? "checked" : ""}> Permitir existencias negativas</label>
      <label class="check"><input name="allowSellerPriceEdit" type="checkbox" ${settings.allowSellerPriceEdit !== false ? "checked" : ""}> El vendedor puede modificar precios</label>
      <label class="field"><span>Logo</span><input name="logo" type="file" accept="image/*"></label>
      <div class="span-2">${can("settings.business") ? `<button class="btn btn-primary" type="submit">Guardar datos del negocio</button>` : `<p class="help">Solo quien tiene permiso puede modificar los datos comerciales. Todos los usuarios usan esta misma ferretería.</p>`}</div>
    </form>
    <section class="split" style="margin-top:14px"><article class="card" id="categories"></article><article class="card" id="units"></article></section>
    <section class="split" style="margin-top:14px"><article class="card" id="methods"></article><article class="card" id="expense-categories"></article></section>
    <section class="card" style="margin-top:14px"><h2>Respaldo</h2><p class="help">Descarga la información actual de Firestore. No sustituye las reglas ni los usuarios de Authentication.</p>${can("settings.business") ? `<div class="inline-actions"><button class="btn btn-primary" id="backup" type="button">Exportar respaldo</button><button class="btn btn-ghost" id="restore" type="button">Restaurar catálogos base</button></div>` : `<p class="help">El respaldo completo lo descarga quien administra la ferretería.</p>`}</section>`
  });
  paintCatalogs();
  bindTheme(root, settings);
  if (!can("settings.business")) {
    root.querySelectorAll("#settings input, #settings select, #settings textarea").forEach((input) => { input.disabled = true; });
  }
  root.querySelector("#settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!can("settings.business")) return toast("No tiene permiso para modificar los datos del negocio.", "err");
    const form = event.currentTarget;
    const data = readForm(form);
    data.allowNegativeStock = form.allowNegativeStock.checked;
    data.allowSellerPriceEdit = form.allowSellerPriceEdit.checked;
    data.defaultMinStock = Number(data.defaultMinStock || 0);
    data.maxDiscountPercent = Number(data.maxDiscountPercent || 0);
    data.country = "Guatemala";
    data.currency = "GTQ";
    data.currencySymbol = "Q";
    data.timezone = "America/Guatemala";
    data.dateFormat = "DD/MM/YYYY";
    await withBusy(form.querySelector("button"), async () => {
      try {
        await saveSettings(data, form.logo.files[0]);
        await loadCatalogs();
        window.dispatchEvent(new Event("ferretov:settings"));
        toast("Configuración guardada.");
        renderSettings(root);
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
  root.querySelector("#backup")?.addEventListener("click", async (event) => {
    await withBusy(event.currentTarget, async () => {
      try {
        const backup = await exportBackup();
        downloadJson(`ferretov-respaldo-${dateStamp()}.json`, backup);
        toast("Respaldo descargado.");
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
  root.querySelector("#restore")?.addEventListener("click", async () => {
    try { await restoreCatalogs(); await loadCatalogs(); toast("Catálogos base restaurados."); renderSettings(root); }
    catch (error) { toast(errorMessage(error), "err"); }
  });
}

function themeCard(settings) {
  if (!can("settings.colors") && !can("settings.business")) return "";
  const primary = settings.themePrimary || "#d4a017";
  const secondary = settings.themeSecondary || "#111111";
  return `<section class="card theme-card">
    <h2>Colores del sistema</h2>
    <p class="help">El cambio se aplica en toda la aplicación y queda guardado para todos los usuarios.</p>
    <div class="theme-presets">${Object.entries(THEME_PRESETS).map(([id, preset]) => `<button type="button" class="theme-swatch ${settings.themePreset === id ? "active" : ""}" data-preset="${id}"><i style="background:${preset.secondary}"></i><i style="background:${preset.primary}"></i><span>${esc(preset.label)}</span></button>`).join("")}</div>
    <div class="form-grid">
      <label class="field"><span>Color principal</span><input id="theme-primary" type="color" value="${esc(primary)}"></label>
      <label class="field"><span>Color secundario</span><input id="theme-secondary" type="color" value="${esc(secondary)}"></label>
    </div>
    <div class="theme-preview"><button class="btn btn-primary" type="button">Botón principal</button><button class="btn btn-ghost" type="button">Secundario</button><span class="badge badge-ok">Activo</span><span class="badge badge-warn">Aviso</span><span class="badge badge-danger">Error</span></div>
    ${can("settings.colors") || can("settings.business") ? `<button class="btn btn-primary" id="save-theme" type="button">Guardar colores</button>` : ""}
  </section>`;
}

function bindTheme(root, settings) {
  const primary = root.querySelector("#theme-primary");
  const secondary = root.querySelector("#theme-secondary");
  if (!primary) return;
  let preset = settings.themePreset || "custom";
  const preview = () => applyTheme({ themePreset: preset, themePrimary: primary.value, themeSecondary: secondary.value });
  primary.addEventListener("input", () => { preset = "custom"; preview(); });
  secondary.addEventListener("input", () => { preset = "custom"; preview(); });
  root.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    const next = THEME_PRESETS[button.dataset.preset];
    preset = button.dataset.preset;
    primary.value = next.primary;
    secondary.value = next.secondary;
    root.querySelectorAll(".theme-swatch").forEach((item) => item.classList.toggle("active", item === button));
    preview();
  }));
  root.querySelector("#save-theme")?.addEventListener("click", async (event) => {
    await withBusy(event.currentTarget, async () => {
      try {
        await saveSettings({ themePreset: preset, themePrimary: primary.value, themeSecondary: secondary.value });
        await loadCatalogs();
        window.dispatchEvent(new Event("ferretov:settings"));
        toast("Colores guardados para toda la ferretería.");
      } catch (error) { toast(errorMessage(error), "err"); }
    });
  });
}

function paintCatalogs() {
  catalog("categories", "Categorías", getCategories(), "categories", can("settings.categories"));
  catalog("units", "Unidades", getUnits(), "units", can("settings.units"));
  catalog("methods", "Métodos de pago", getMethods(), "paymentMethods", can("settings.methods"));
  catalog("expense-categories", "Categorías de gasto", getExpenseCategories(), "expenseCategories", can("settings.categories"));
}

function catalog(id, title, rows, collectionName, allowed) {
  const host = document.getElementById(id);
  host.innerHTML = `<h2>${title}</h2>${rows.map((item) => `<p>${esc(item.name)} ${item.locked ? "<small>(protegido)</small>" : ""}</p>`).join("") || "<p class='help'>Sin registros.</p>"}${allowed ? `<button class="btn btn-ghost" type="button">Agregar</button>` : ""}`;
  if (!allowed) return;
  host.querySelector("button").addEventListener("click", async () => {
    const name = await askText({ title: `Nueva opción`, label: title, confirmText: "Agregar" });
    if (!name) return;
    try {
      await saveCatalogItem(collectionName, null, { name: name.trim(), symbol: name.trim(), code: "other", active: true, locked: false, requiresReference: false });
      await loadCatalogs();
      toast("Guardado.");
      paintCatalogs();
    } catch (error) { toast(errorMessage(error), "err"); }
  });
}

async function restoreCatalogs() {
  const batch = writeBatch(db);
  const now = Timestamp.now();
  DEFAULT_UNITS.forEach(([id, name, symbol]) => batch.set(doc(db, "units", id), { name, symbol, active: true, createdAt: now }, { merge: true }));
  DEFAULT_METHODS.forEach(([id, name, code, requiresReference, locked]) => batch.set(doc(db, "paymentMethods", id), { name, code, requiresReference, locked, active: true, createdAt: now }, { merge: true }));
  DEFAULT_EXPENSE_CATEGORIES.forEach(([id, name]) => batch.set(doc(db, "expenseCategories", id), { name, active: true, createdAt: now }, { merge: true }));
  await batch.commit();
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
