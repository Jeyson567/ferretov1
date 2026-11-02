import { db } from "./firebase-config.js";
import { watchAuth, getSession, login, logout, registerAccount, resetPassword, setupBusiness } from "./auth.js";
import { getSettings, loadCatalogs } from "./state.js";
import { can, ROLE_LABELS } from "./permissions.js";
import { renderRoute } from "./router.js";
import { esc, errorMessage, dateKey } from "./utils.js";
import { icon, toast } from "./ui.js";
import { globalSearch, saveSettings } from "./operations.js";
import { collection, doc, getDocs, limit, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import "./modules/dashboard.js";
import "./modules/inventory.js";
import "./modules/movements.js";
import "./modules/entries.js";
import "./modules/pos.js";
import "./modules/sales.js";
import "./modules/customers.js";
import "./modules/receivables.js";
import "./modules/quotes.js";
import "./modules/suppliers.js";
import "./modules/expenses.js";
import "./modules/reports.js";
import "./modules/settings.js";
import "./modules/users.js?v=20261102f";
import "./modules/audit.js";

const MENU = [
  { section: "General", items: [    { path: "/", label: "Panel", icon: "grid", perm: "dashboard.view" }] },
  { section: "Ventas", items: [
    { path: "/pos", label: "Punto de venta", icon: "cart", perm: "pos.access" },
    { path: "/ventas", label: "Historial de ventas", icon: "file", perm: "sales.view" },
    { path: "/cotizaciones", label: "Cotizaciones", icon: "file", perm: "quotes.view" }
  ] },
  { section: "Clientes", items: [
    { path: "/clientes", label: "Clientes", icon: "users", perm: "customers.view" },
    { path: "/cxc", label: "Cuentas por cobrar", icon: "card", perm: "receivables.view" }
  ] },
  { section: "Inventario", items: [
    { path: "/inventario", label: "Productos", icon: "box", perm: "inventory.view" },
    { path: "/movimientos", label: "Movimientos", icon: "chart", perm: "inventory.movements" },
    { path: "/entradas", label: "Entradas", icon: "truck", perm: "suppliers.entries" },
    { path: "/proveedores", label: "Proveedores", icon: "truck", perm: "suppliers.view" }
  ] },
  { section: "Administración", items: [
    { path: "/gastos", label: "Gastos", icon: "card", perm: "expenses.view" },
    { path: "/reportes", label: "Reportes", icon: "chart", perm: "reports.view" },
    { path: "/configuracion", label: "Configuración", icon: "gear", perm: "settings.view" },
    { path: "/usuarios", label: "Usuarios y permisos", icon: "users", perm: "settings.users" },
    { path: "/auditoria", label: "Auditoría", icon: "file", perm: "settings.audit" }
  ] }
];

const screens = ["boot", "login", "setup", "denied", "app"];
let profileUnsub = null;

function show(id) {
  screens.forEach((name) => document.getElementById(name).classList.toggle("hidden", name !== id));
}

function help() {
  return `<div class="help"><p><strong>Antes del primer uso publique las reglas del proyecto ferretov-74fae:</strong></p>
    <ol>
      <li>Firebase Console → Authentication → Correo electrónico/contraseña → Habilitar.</li>
      <li>Firestore Database → crear la base en modo producción.</li>
      <li>Storage → comenzar.</li>
      <li>Authentication → Settings → Authorized domains → agregar <em>localhost</em>.</li>
      <li>En esta carpeta: <code>firebase deploy --only firestore,storage --project ferretov-74fae</code></li>
    </ol>
    <p>La primera cuenta, antes de guardar la ferretería, queda como propietaria. Los empleados los crea el propietario y no vuelven a configurar el negocio.</p></div>`;
}

function renderLogin() {
  show("login");
  document.getElementById("login").innerHTML = `<div class="auth-card"><section class="auth-brand"><img src="LOGO%20FERRETOV.png" alt="FERRETOV"><div><h2>FERRETOV</h2><p>Inventario, ventas, créditos, cotizaciones y gastos de la ferretería, con la información guardada en Firebase.</p></div></section>
    <form id="login-form" class="auth-form stack"><h1>Ingresar</h1><p class="muted">Use su correo y contraseña.</p>
      <label class="field req"><span>Correo</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="field req"><span>Contraseña</span><input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn btn-primary" type="submit">Entrar</button>
      <button class="btn btn-ghost" type="button" id="register">Crear cuenta</button>
      <button class="linkish" type="button" id="reset">Olvidé mi contraseña</button>
    </form></div>`;
  const form = document.getElementById("login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try { await login(data.get("email"), data.get("password")); }
    catch (error) { toast(errorMessage(error), "err"); }
  });
  document.getElementById("register").addEventListener("click", async () => {
    const data = new FormData(form);
    try { await registerAccount(data.get("email"), data.get("password")); }
    catch (error) { toast(errorMessage(error), "err"); }
  });
  document.getElementById("reset").addEventListener("click", async () => {
    const email = new FormData(form).get("email");
    if (!email) return toast("Escriba su correo para enviar el enlace.", "err");
    try {
      await resetPassword(email);
      toast("Enviamos el enlace de recuperación si la cuenta existe.");
    } catch (error) { toast(errorMessage(error), "err"); }
  });
}

function renderSetup(user) {
  show("setup");
  document.getElementById("setup").innerHTML = `<div class="auth-card"><section class="auth-brand"><img src="LOGO%20FERRETOV.png" alt="FERRETOV"><p>Configure el negocio una sola vez. Después podrá cambiar estos datos en Configuración.</p></section>
    <form id="setup-form" class="auth-form stack"><h1>Configurar ferretería</h1>
      <label class="field req"><span>Su nombre</span><input name="adminName" required value="${esc(user.displayName || "")}"></label>
      <label class="field req"><span>Nombre de la ferretería</span><input name="businessName" required value="FERRETOV"></label>
      <label class="field"><span>NIT</span><input name="nit"></label>
      <label class="field"><span>Dirección</span><input name="address"></label>
      <label class="field"><span>Teléfono</span><input name="phone"></label>
      <label class="field"><span>WhatsApp</span><input name="whatsapp" placeholder="8 dígitos o 502..."></label>
      <label class="field"><span>Correo del negocio</span><input name="email" type="email"></label>
      <label class="field"><span>Moneda</span><select name="currency" disabled><option value="GTQ">Quetzales (Q)</option></select></label>
      <label class="field"><span>Nota de los comprobantes</span><textarea name="ticketFooter">Gracias por su compra.</textarea></label>
      <label class="field"><span>Logo</span><input name="logo" type="file" accept="image/*"></label>
      <button class="btn btn-primary" type="submit">Guardar e ingresar</button>
      ${help()}
    </form></div>`;
  document.getElementById("setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await setupBusiness(user, data);
      const logo = event.currentTarget.logo.files[0];
      if (logo) await saveSettings({}, logo);
      await enter();
    } catch (error) { toast(errorMessage(error), "err"); }
  });
}

function renderDenied(message, config = false) {
  show("denied");
  document.getElementById("denied").innerHTML = `<div class="auth-card"><section class="auth-brand"><img src="LOGO%20FERRETOV.png" alt="FERRETOV"><p>El acceso está protegido con Firebase Authentication y reglas de Firestore.</p></section>
    <div class="auth-form stack"><h1>No se pudo entrar</h1><div class="banner banner-danger">${esc(message || "Acceso denegado.")}</div>
      ${config ? help() : "<p class='muted'>Pida al propietario que cree su usuario. No es necesario registrar otra vez la ferretería.</p>"}
      <button class="btn btn-primary" id="leave" type="button">Cerrar sesión</button></div></div>`;
  document.getElementById("leave").addEventListener("click", () => logout());
}

async function enter() {
  try { await loadCatalogs(); }
  catch (error) { renderDenied(errorMessage(error), true); return; }
  buildShell();
  show("app");
  if (!location.hash || location.hash === "#") location.hash = "/";
  renderRoute();
  watchProfile();
  if (!window.__ferretovSettings) {
    window.__ferretovSettings = true;
    window.addEventListener("ferretov:settings", () => {
      if (!document.getElementById("app").classList.contains("hidden")) buildShell();
    });
  }
}

function buildShell() {
  const session = getSession();
  const settings = getSettings();
  const links = MENU.map((group) => {
    const items = group.items.filter((item) => can(item.perm));
    if (!items.length) return "";
    return `<div class="nav-section">${group.section}</div>${items.map((item) => `<a class="nav-link" data-nav="${item.path}" href="#${item.path}">${icon(item.icon)}<span>${item.label}</span></a>`).join("")}`;
  }).join("");
  document.getElementById("sidebar").innerHTML = `<div class="brand"><img src="${esc(settings.logoUrl || "LOGO%20FERRETOV.png")}" alt=""><div><strong>${esc(settings.businessName || "FERRETOV")}</strong><span>Ferretería</span></div></div>${links}
    <div class="side-user"><div><strong>${esc(session.name)}</strong><small>${esc(ROLE_LABELS[session.role] || session.role)}</small></div><a class="icon-btn" href="#/perfil" aria-label="Perfil">${icon("gear")}</a></div>`;
  document.getElementById("topbar").innerHTML = `<button class="icon-btn menu-btn" id="menu-btn" type="button" aria-label="Menú">☰</button>
    <div class="search"><input id="global-search" placeholder="Buscar producto, cliente o número de documento" autocomplete="off"><div id="search-results" class="suggest" hidden></div></div>
    <div class="top-actions"><div class="bell"><button class="icon-btn" id="bell" type="button" aria-label="Alertas">${icon("bell")}<span id="bell-count" class="dot hidden">0</span></button><div id="bell-menu" class="menu-pop hidden"></div></div>
      <button class="btn btn-ghost" id="logout" type="button">Salir</button></div>`;
  document.getElementById("menu-btn").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("sidebar").addEventListener("click", (event) => {
    if (event.target.closest("a")) document.getElementById("sidebar").classList.remove("open");
  });
  document.getElementById("logout").addEventListener("click", () => logout());
  const input = document.getElementById("global-search");
  const results = document.getElementById("search-results");
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (input.value.trim().length < 2) { results.hidden = true; return; }
      try {
        const rows = await globalSearch(input.value);
        results.hidden = false;
        results.innerHTML = rows.length ? rows.map((row) => `<a href="${esc(row.href)}"><strong>${esc(row.title)}</strong><small>${esc(row.subtitle || row.type)}</small></a>`).join("") : `<div class="suggest-empty">Sin resultados</div>`;
        results.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => { results.hidden = true; input.value = ""; }));
      } catch (error) { toast(errorMessage(error), "err"); }
    }, 250);
  });
  document.getElementById("bell").addEventListener("click", async () => {
    const menu = document.getElementById("bell-menu");
    menu.classList.toggle("hidden");
    if (menu.classList.contains("hidden")) return;
    menu.innerHTML = `<div class="suggest-empty">Cargando alertas…</div>`;
    menu.innerHTML = await alertsHtml();
  });
  refreshAlertCount();
}

async function alertItems() {
  const items = [];
  if (can("inventory.view")) {
    const snap = await getDocs(query(collection(db, "products"), where("lowStock", "==", true), limit(8)));
    snap.docs.forEach((item) => items.push({ href: "#/inventario", title: item.data().name, text: `Existencia ${item.data().stock} ${item.data().unitName || ""}` }));
  }
  if (can("receivables.view")) {
    const snap = await getDocs(query(collection(db, "receivables"), where("status", "in", ["open", "partial"]), limit(40)));
    const today = dateKey();
    snap.docs.filter((item) => item.data().dueDate && item.data().dueDate < today).slice(0, 8).forEach((item) => {
      items.push({ href: "#/cxc", title: item.data().customerName, text: `Saldo vencido de la venta ${item.data().saleNumber}` });
    });
  }
  return items;
}

async function alertsHtml() {
  try {
    const items = await alertItems();
    if (!items.length) return `<div class="suggest-empty">No hay alertas pendientes.</div>`;
    return items.map((item) => `<a href="${esc(item.href)}"><strong>${esc(item.title)}</strong><small>${esc(item.text)}</small></a>`).join("");
  } catch (error) {
    return `<div class="suggest-empty">${esc(errorMessage(error))}</div>`;
  }
}

async function refreshAlertCount() {
  try {
    const items = await alertItems();
    const badge = document.getElementById("bell-count");
    if (!badge) return;
    badge.textContent = String(items.length);
    badge.classList.toggle("hidden", items.length === 0);
  } catch {
    /* Las alertas no deben bloquear el uso del sistema. */
  }
}

function watchProfile() {
  if (profileUnsub) profileUnsub();
  const session = getSession();
  profileUnsub = onSnapshot(doc(db, "users", session.uid), (snap) => {
    if (!snap.exists() || snap.data().active === false) {
      toast("Su usuario fue desactivado.", "err");
      logout();
      return;
    }
    if (snap.data().role !== session.role || snap.data().name !== session.name || JSON.stringify(snap.data().permissions || null) !== JSON.stringify(session.permissions || null)) {
      session.role = snap.data().role;
      session.name = snap.data().name;
      session.permissions = snap.data().permissions || null;
      session.active = snap.data().active !== false;
      buildShell();
      renderRoute();
    }
  });
}

watchAuth(async (state) => {
  if (profileUnsub && state.status !== "ready") { profileUnsub(); profileUnsub = null; }
  if (state.status === "checking") show("boot");
  if (state.status === "signed-out") renderLogin();
  if (state.status === "setup") renderSetup(state.user);
  if (state.status === "denied") renderDenied(state.reason);
  if (state.status === "error") renderDenied(state.message, true);
  if (state.status === "ready") await enter();
});
