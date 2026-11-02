import { db } from "../firebase-config.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { getSession } from "../auth.js";
import { PERMISSION_MODULES, PERMISSION_TEMPLATES, ROLE_LABELS, can, normalizePermissions } from "../permissions.js";
import { saveStaff } from "../staff.js?v=20261102f";
import { updateOwnName } from "../operations.js";
import { resetPassword } from "../auth.js";
import { errorMessage, esc, formatDateTime } from "../utils.js";
import { field, openModal, page, table, toast, withBusy } from "../ui.js";

defineRoute("/usuarios", { perm: "settings.users", title: "Usuarios y permisos", render: renderUsers });
defineRoute("/perfil", { perm: "profile", title: "Perfil", render: renderProfile });

async function renderUsers(root) {
  const session = getSession();
  const load = async () => {
    const snap = await getDocs(query(collection(db, "users"), orderBy("name"), limit(200)));
    const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    root.innerHTML = page({
      title: "Usuarios y permisos",
      subtitle: "Una sola ferretería. El propietario decide qué ve y qué hace cada persona.",
      actions: can("settings.permissions") ? `<button class="btn btn-primary" id="new-user" type="button">Nuevo usuario</button>` : "",
      body: table([
        { label: "Nombre", render: (row) => esc(row.name) },
        { label: "Correo", render: (row) => esc(row.email) },
        { label: "Rol", render: (row) => esc(ROLE_LABELS[row.role] || row.role) },
        { label: "Estado", render: (row) => row.active === false ? "Inactivo" : "Activo" },
        { label: "Creado", render: (row) => formatDateTime(row.createdAt) },
        { label: "Último acceso", render: (row) => formatDateTime(row.lastAccessAt) },
        { label: "", render: (row) => canEdit(session, row) ? `<button class="btn btn-ghost" data-edit="${esc(row.id)}" type="button">Editar</button>` : row.role === "owner" ? "Protegido" : "" }
      ], rows, "No hay usuarios.")
    });
    root.querySelector("#new-user")?.addEventListener("click", () => userForm(null, load));
    root.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => userForm(rows.find((row) => row.id === button.dataset.edit), load)));
  };
  try { await load(); }
  catch (error) { root.innerHTML = page({ title: "Usuarios y permisos", body: `<div class="banner banner-danger">${esc(errorMessage(error))}</div>` }); }
}

function canEdit(session, row) {
  if (!can("settings.permissions") || row.role === "owner") return false;
  if (session.role !== "owner" && row.role === "admin") return false;
  return true;
}

export function userForm(user, reload = () => {}, session = getSession()) {
  const permissions = normalizePermissions(user?.permissions);
  const modal = openModal({
    title: user ? user.name : "Nuevo usuario",
    size: "lg",
    content: `<form id="staff" class="stack">
      ${field({ label: "Nombre", name: "name", value: user?.name || "", required: true })}
      ${user ? `<p>${esc(user.email)}</p><p class="help">Para cambiar la contraseña se envía un enlace al correo. La sesión del propietario no se cierra.</p><button class="btn btn-ghost" id="staff-reset" type="button">Enviar enlace de contraseña</button>` : field({ label: "Correo", name: "email", type: "email", required: true })}
      ${user ? "" : field({ label: "Contraseña inicial", name: "password", type: "password", required: true, attrs: 'minlength="6" autocomplete="new-password"' })}
      ${field({ label: "Tipo", name: "role", type: "select", value: user?.role === "admin" ? "admin" : "employee", options: roleOptions(session) })}
      <div class="inline-actions" id="templates">${PERMISSION_TEMPLATES.filter((item) => session.role === "owner" || item.role !== "admin").map((item) => `<button class="btn btn-ghost" type="button" data-template="${item.id}">${esc(item.label)}</button>`).join("")}</div>
      <div class="inline-actions"><button class="btn btn-ghost" type="button" id="all-on">Marcar todos</button><button class="btn btn-ghost" type="button" id="all-off">Desmarcar todos</button></div>
      <div id="matrix" class="perm-matrix">${matrixHtml(permissions, session)}</div>
      ${user ? `<label class="check"><input name="active" type="checkbox" ${user.active !== false ? "checked" : ""}> Usuario activo</label>` : ""}
      <p class="help">${user ? "Los permisos y el estado se guardan en Firestore. Una cuenta inactiva no puede consultar la información del negocio." : "La cuenta se crea sin cerrar su sesión. Si el correo ya existe sin perfil, Guardar lo completa y no crea otra cuenta."}</p>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close type="button">Cancelar</button><button class="btn btn-primary" id="save-user" type="button">Guardar usuario</button>`
  });
  const matrix = modal.body.querySelector("#matrix");
  const syncChecks = () => {
    matrix.querySelectorAll("[data-perm]").forEach((input) => {
      const [module, action] = input.dataset.perm.split(".");
      input.checked = permissions[module]?.[action] === true;
    });
  };
  const setOne = (module, action, checked) => {
    if (!permissions[module] || !(action in permissions[module])) return;
    if (!actorAllows(session, module, action)) return;
    permissions[module][action] = checked === true;
  };
  const setModule = (module, value) => {
    if (!permissions[module]) return;
    Object.keys(permissions[module]).forEach((action) => {
      if (actorAllows(session, module, action)) permissions[module][action] = value === true;
    });
    syncChecks();
  };
  const setAll = (value) => {
    PERMISSION_MODULES.forEach((module) => setModule(module.id, value));
  };
  matrix.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("[data-perm]")) return;
    const [module, action] = input.dataset.perm.split(".");
    if (!actorAllows(session, module, action)) {
      input.checked = permissions[module]?.[action] === true;
      return;
    }
    setOne(module, action, input.checked);
  });
  matrix.addEventListener("click", (event) => {
    const on = event.target.closest("[data-module-on]");
    const off = event.target.closest("[data-module-off]");
    const collapse = event.target.closest("[data-collapse]");
    if (!on && !off && !collapse) return;
    event.preventDefault();
    if (on) setModule(on.dataset.moduleOn, true);
    else if (off) setModule(off.dataset.moduleOff, false);
    else collapse.closest(".perm-module")?.classList.toggle("collapsed");
  });
  modal.body.querySelector("#staff-reset")?.addEventListener("click", async () => {
    try {
      await resetPassword(user.email);
      toast("Se envió el enlace de contraseña. Su sesión sigue abierta.");
    } catch (error) { toast(errorMessage(error), "err"); }
  });
  modal.body.querySelector("#all-on").addEventListener("click", () => setAll(true));
  modal.body.querySelector("#all-off").addEventListener("click", () => setAll(false));
  modal.body.querySelectorAll("[data-template]").forEach((button) => button.addEventListener("click", () => {
    const template = PERMISSION_TEMPLATES.find((item) => item.id === button.dataset.template);
    if (!template) return;
    modal.body.querySelector("[name=role]").value = template.role === "admin" && session.role === "owner" ? "admin" : "employee";
    const next = normalizePermissions(template.permissions);
    PERMISSION_MODULES.forEach((module) => module.actions.forEach(([action]) => {
      if (actorAllows(session, module.id, action)) permissions[module.id][action] = next[module.id][action] === true;
    }));
    syncChecks();
  }));
  let pendingUid = "";
  modal.el.querySelector("#save-user").addEventListener("click", async (event) => {
    const form = modal.body.querySelector("#staff");
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const selected = normalizePermissions(permissions);
    await withBusy(event.currentTarget, async () => {
      try {
        const saved = await saveStaff({
          action: user ? "update" : "create",
          uid: user?.id || pendingUid,
          name: data.get("name"),
          email: data.get("email"),
          password: data.get("password"),
          role: data.get("role"),
          active: user ? form.active.checked : true,
          permissions: selected
        });
        if (!user && saved?.uid) pendingUid = "";
        toast(user ? "Usuario actualizado." : "Usuario creado. El perfil y los permisos quedaron guardados.");
        modal.close();
        reload();
      } catch (error) {
        if (!user && error.uid) pendingUid = error.uid;
        toast(errorMessage(error), "err");
      }
    });
  });
}

function actorAllows(session, module, action) {
  if (!session || session.active === false) return false;
  if (session.role === "owner" || (session.role === "admin" && !session.permissions)) return true;
  return session.permissions?.[module]?.[action] === true;
}

function roleOptions(session) {
  const options = [{ value: "employee", label: "Empleado" }];
  if (session.role === "owner") options.push({ value: "admin", label: "Administrador" });
  return options;
}

function matrixHtml(permissions, session) {
  return PERMISSION_MODULES.map((module) => `<section class="perm-module">
    <header><button type="button" data-collapse="${module.id}">${esc(module.label)}</button><span><button type="button" data-module-on="${module.id}">Marcar módulo</button><button type="button" data-module-off="${module.id}">Desmarcar</button></span></header>
    <div class="perm-grid">${module.actions.map(([id, label]) => {
      const allowed = session.role === "owner" || session.permissions?.[module.id]?.[id] === true;
      return `<label class="check"><input type="checkbox" data-perm="${module.id}.${id}" ${permissions[module.id][id] ? "checked" : ""} ${allowed ? "" : "disabled"}> ${esc(label)}</label>`;
    }).join("")}</div>
  </section>`).join("");
}

async function renderProfile(root) {
  const session = getSession();
  root.innerHTML = page({
    title: "Mi perfil",
    subtitle: ROLE_LABELS[session.role] || session.role,
    body: `<form id="profile" class="card stack profile-card">
      <p>${esc(session.email)}</p>
      ${field({ label: "Nombre", name: "name", value: session.name, required: true })}
      <button class="btn btn-primary" type="submit">Guardar nombre</button>
      <button class="btn btn-ghost" id="reset" type="button">Enviar enlace para cambiar contraseña</button>
    </form>`
  });
  root.querySelector("#profile").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await updateOwnName(new FormData(event.currentTarget).get("name")); toast("Nombre actualizado."); }
    catch (error) { toast(errorMessage(error), "err"); }
  });
  root.querySelector("#reset").addEventListener("click", async () => {
    try { await resetPassword(session.email); toast("Revise su correo para cambiar la contraseña."); }
    catch (error) { toast(errorMessage(error), "err"); }
  });
}
