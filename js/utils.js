import { roundMoney } from "./calc.js";
import { dateKey } from "./dates.js";

export * from "./calc.js";
export * from "./dates.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

export function money(value) {
  const number = roundMoney(value || 0);
  const formatted = number.toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `Q ${formatted}`;
}

export function qty(value) {
  const number = Number(value || 0);
  return number.toLocaleString("es-GT", { maximumFractionDigits: 3 });
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function padNumber(prefix, value) {
  return `${prefix}-${String(value).padStart(6, "0")}`;
}

export function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function phoneDigits(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `502${digits}`;
  return digits;
}

export function errorMessage(error) {
  const code = error?.code || "";
  const text = String(error?.message || "");
  if (code === "permission-denied") {
    return "No tiene permiso para esta operación. Confirme su rol y que las reglas de Firestore estén publicadas.";
  }
  if (code === "unavailable" || code === "auth/network-request-failed") {
    return "No hay conexión con Firebase. Revise su internet e intente de nuevo.";
  }
  if (code === "failed-precondition" && text.includes("index")) {
    return `Falta un índice de Firestore. Ábralo desde la consola y créelo: ${extractUrl(text) || text}`;
  }
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-email") {
    return "Correo o contraseña incorrectos.";
  }
  if (code === "auth/email-already-in-use") return "Ese correo ya está registrado.";
  if (code === "auth/weak-password") return "La contraseña debe tener al menos 6 caracteres.";
  if (code === "auth/too-many-requests") return "Demasiados intentos. Espere un momento e intente de nuevo.";
  if (code === "auth/operation-not-allowed") {
    return "Active el acceso con correo y contraseña en Firebase Authentication.";
  }
  if (code === "auth/configuration-not-found" || code === "auth/invalid-api-key") {
    return "Firebase Authentication no está habilitado para este proyecto. Actívelo en la consola y autorice localhost.";
  }
  if (code === "storage/unauthorized") return "No tiene permiso para subir este archivo. Publique las reglas de Storage.";
  if (code === "storage/canceled") return "La carga del archivo fue cancelada.";
  return text || "Ocurrió un error inesperado.";
}

export function extractUrl(text) {
  const match = String(text || "").match(/https:\/\/\S+/);
  return match ? match[0].replace(/[),.;]+$/, "") : "";
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function todayIsoDate() {
  return dateKey();
}
