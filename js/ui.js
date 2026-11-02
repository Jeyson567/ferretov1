import { esc } from "./utils.js";

export function toast(message, type = "ok") {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  item.textContent = message;
  root.appendChild(item);
  setTimeout(() => item.remove(), type === "err" ? 8000 : 3800);
}

export function closeModals() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

export function openModal({ title, content, footer = "", size = "md", dismissible = true, onDismiss } = {}) {
  const root = document.getElementById("modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `
    <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        ${dismissible ? '<button type="button" class="icon-btn" data-close aria-label="Cerrar">×</button>' : ""}
      </header>
      <div class="modal-body">${content}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ""}
    </div>`;
  root.appendChild(wrap);
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    document.removeEventListener("keydown", onKey);
    onDismiss?.();
  };
  wrap.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", close));
  if (dismissible) {
    wrap.addEventListener("click", (event) => {
      if (event.target === wrap) close();
    });
  }
  const onKey = (event) => {
    if (event.key === "Escape" && dismissible) close();
  };
  document.addEventListener("keydown", onKey);
  return { close, el: wrap, body: wrap.querySelector(".modal-body") };
}

export function confirmDialog({
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  danger = false,
  requireText = ""
}) {
  return new Promise((resolve) => {
    const extra = requireText
      ? `<label class="field"><span>Escriba <strong>${esc(requireText)}</strong> para continuar</span><input name="confirmText" autocomplete="off"></label>`
      : "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value);
    };
    const modal = openModal({
      title,
      size: "sm",
      onDismiss: () => finish(false),
      content: `<p class="confirm-copy">${esc(message)}</p>${extra}`,
      footer: `
        <button type="button" class="btn btn-ghost" data-cancel>${esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button>`
    });
    modal.el.querySelector("[data-cancel]").addEventListener("click", () => finish(false));
    modal.el.querySelector("[data-ok]").addEventListener("click", () => {
      if (requireText) {
        const typed = modal.body.querySelector("[name=confirmText]").value.trim();
        if (typed !== requireText) {
          toast(`Escriba exactamente ${requireText}.`, "err");
          return;
        }
      }
      finish(true);
    });
  });
}

export function askText({ title, label, message = "", required = true, confirmText = "Guardar" }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value);
    };
    const modal = openModal({
      title,
      size: "sm",
      onDismiss: () => finish(null),
      content: `${message ? `<p class="confirm-copy">${esc(message)}</p>` : ""}<label class="field${required ? " req" : ""}"><span>${esc(label)}</span><input name="value" autocomplete="off"></label>`,
      footer: `<button type="button" class="btn btn-ghost" data-cancel>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${esc(confirmText)}</button>`
    });
    const input = modal.body.querySelector("[name=value]");
    input.focus();
    const submit = () => {
      const value = input.value.trim();
      if (required && !value) {
        toast("Escriba un valor para continuar.", "err");
        return;
      }
      finish(value);
    };
    modal.el.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
    modal.el.querySelector("[data-ok]").addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
  });
}

export async function withBusy(button, work) {
  if (!button || button.dataset.busy === "1") return undefined;
  button.dataset.busy = "1";
  button.disabled = true;
  const previous = button.innerHTML;
  button.innerHTML = `<span class="spinner"></span><span>Procesando…</span>`;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.dataset.busy = "0";
    button.innerHTML = previous;
  }
}

export function page({ title, subtitle = "", actions = "", body = "", extra = "" }) {
  return `<section class="page ${extra}">
    <header class="page-head">
      <div><h1>${title}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ""}</div>
      <div class="page-actions">${actions}</div>
    </header>
    ${body}
  </section>`;
}

export function loadingBlock(text = "Cargando información…") {
  return `<div class="loading-block"><span class="spinner"></span><span>${esc(text)}</span></div>`;
}

export function emptyState(title, text, action = "") {
  return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(text)}</p>${action}</div>`;
}

export function errorBlock(message) {
  return `<div class="banner banner-danger">${esc(message)}</div>`;
}

export function badge(text, tone = "neutral") {
  return `<span class="badge badge-${tone}">${esc(text)}</span>`;
}

export function table(columns, rows, empty = "No hay registros.") {
  if (!rows.length) return emptyState("Sin resultados", empty);
  const head = columns.map((column) => `<th class="${column.class || ""}">${column.label}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => {
    const value = column.render(row);
    return `<td class="${column.class || ""}" data-label="${esc(column.label)}">${value}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function pager({ page, pages, total }) {
  return `<div class="pager">
    <button type="button" class="btn btn-ghost" data-page="prev" ${page <= 1 ? "disabled" : ""}>Anterior</button>
    <span>Página ${page} de ${pages} · ${total} registros</span>
    <button type="button" class="btn btn-ghost" data-page="next" ${page >= pages ? "disabled" : ""}>Siguiente</button>
  </div>`;
}

export function slicePage(items, page, size = 15) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return { page: current, pages, total: items.length, rows: items.slice(start, start + size) };
}

export function field({ label, name, type = "text", value = "", required = false, options = null, placeholder = "", attrs = "" }) {
  const mark = required ? " req" : "";
  if (type === "textarea") {
    return `<label class="field${mark}"><span>${esc(label)}</span><textarea name="${esc(name)}" ${required ? "required" : ""} ${attrs}>${esc(value)}</textarea></label>`;
  }
  if (type === "select") {
    const opts = options.map((option) => {
      const selected = String(option.value) === String(value) ? "selected" : "";
      return `<option value="${esc(option.value)}" ${selected}>${esc(option.label)}</option>`;
    }).join("");
    return `<label class="field${mark}"><span>${esc(label)}</span><select name="${esc(name)}" ${required ? "required" : ""} ${attrs}>${opts}</select></label>`;
  }
  return `<label class="field${mark}"><span>${esc(label)}</span><input type="${esc(type)}" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? "required" : ""} ${attrs}></label>`;
}

export function readForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = String(value).trim();
  });
  return data;
}

export function saleStatusBadge(status) {
  const map = {
    completed: ["Completada", "ok"],
    partial_return: ["Devolución parcial", "warn"],
    returned: ["Devuelta", "info"],
    void: ["Anulada", "danger"]
  };
  const [text, tone] = map[status] || [status || "—", "neutral"];
  return badge(text, tone);
}

export function payStatusBadge(status) {
  const map = {
    paid: ["Pagada", "ok"],
    partial: ["Pago parcial", "warn"],
    credit: ["Crédito", "info"],
    void: ["Anulada", "danger"]
  };
  const [text, tone] = map[status] || [status || "—", "neutral"];
  return badge(text, tone);
}

export function quoteStatusBadge(status) {
  const map = {
    draft: ["Borrador", "neutral"],
    pending: ["Pendiente", "warn"],
    sent: ["Enviada", "info"],
    approved: ["Aprobada", "ok"],
    rejected: ["Rechazada", "danger"],
    expired: ["Vencida", "danger"],
    converted: ["Convertida", "gold"]
  };
  const [text, tone] = map[status] || [status || "—", "neutral"];
  return badge(text, tone);
}

export function icon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    cart: '<path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
    box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    users: '<path d="M16 19v-1.2A3.8 3.8 0 0 0 12.2 14H7.8A3.8 3.8 0 0 0 4 17.8V19"/><circle cx="10" cy="8" r="3"/><path d="M20 19v-1.1A3.2 3.2 0 0 0 17.2 15"/><path d="M16 5.2a3 3 0 0 1 0 5.6"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    truck: '<path d="M3 7h11v10H3z"/><path d="M14 11h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
    bell: '<path d="M6 16V10a6 6 0 1 1 12 0v6l1.5 2H4.5z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/>',
    logout: '<path d="M10 7V5H4v14h6v-2"/><path d="M10 12h10"/><path d="M16 8l4 4-4 4"/>'
  };
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}
