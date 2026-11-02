export const TIMEZONE = "America/Guatemala";

export function dateKeyFrom(date = new Date(), timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function dateKey(date = new Date()) {
  return dateKeyFrom(date);
}

export function formatDateKey(key) {
  if (!key) return "—";
  const [y, m, d] = String(key).split("-");
  if (!y || !m || !d) return String(key);
  return `${d}/${m}/${y}`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function addDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function daysBetween(fromKey, toKey) {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function monthRange(anchor = dateKey()) {
  const [y, m] = anchor.split("-");
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(last).padStart(2, "0")}`
  };
}

export function yearRange(anchor = dateKey()) {
  const y = anchor.slice(0, 4);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function weekRange(anchor = dateKey()) {
  const midday = keyToDate(anchor);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short"
  }).format(midday);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = map[wd] ?? 0;
  const sinceMonday = (day + 6) % 7;
  return {
    start: addDays(anchor, -sinceMonday),
    end: addDays(anchor, 6 - sinceMonday)
  };
}

export function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 18, 0, 0));
}

export function agingBucket(dueKey, todayKey) {
  if (!dueKey) return "sin_fecha";
  const days = daysBetween(dueKey, todayKey);
  if (days <= 0) return "al_dia";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "mas_90";
}

export const AGING_LABELS = {
  al_dia: "Al día",
  "1_30": "1 a 30 días",
  "31_60": "31 a 60 días",
  "61_90": "61 a 90 días",
  mas_90: "Más de 90 días",
  sin_fecha: "Sin fecha"
};
