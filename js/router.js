import { can } from "./permissions.js";
import { applyTheme } from "./theme.js";
import { getSettings } from "./state.js";
import { closeModals, emptyState, errorBlock, loadingBlock } from "./ui.js";
import { errorMessage } from "./utils.js";

const routes = new Map();
let cleanup = null;
let token = 0;

export function defineRoute(path, config) {
  routes.set(path, config);
}

export function parseHash() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  const [path, query] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(query || "") };
}

export function go(path) {
  const next = path.startsWith("#") ? path : `#${path}`;
  if (`#${location.hash.replace(/^#/, "")}` === next) renderRoute();
  else location.hash = next.slice(1);
}

export async function renderRoute() {
  const current = ++token;
  closeModals();
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  const view = document.getElementById("view");
  if (!view) return;
  const { path, params } = parseHash();
  applyTheme(getSettings());
  const route = routes.get(path);
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === path);
  });
  if (!route) {
    view.innerHTML = emptyState("Página no encontrada", "Elija un módulo del menú.");
    return;
  }
  if (!can(route.perm)) {
    view.innerHTML = emptyState("Acceso restringido", "Su usuario no tiene permiso para este módulo.");
    return;
  }
  document.title = `${route.title} · FERRETOV`;
  view.innerHTML = loadingBlock();
  try {
    const done = await route.render(view, { params });
    if (current !== token) {
      if (typeof done === "function") done();
      return;
    }
    cleanup = done;
  } catch (error) {
    if (current !== token) return;
    view.innerHTML = errorBlock(errorMessage(error));
  }
}

window.addEventListener("hashchange", () => {
  if (document.getElementById("app")?.classList.contains("hidden")) return;
  renderRoute();
});
