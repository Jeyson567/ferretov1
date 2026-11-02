export const THEME_PRESETS = {
  ferretov: { label: "FERRETOV", primary: "#d4a017", secondary: "#111111" },
  industrial: { label: "Azul industrial", primary: "#1d4f91", secondary: "#0e1c33" },
  taller: { label: "Verde taller", primary: "#0f7a45", secondary: "#10241a" },
  grafito: { label: "Grafito", primary: "#5c6570", secondary: "#1c1f24" }
};

export function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const next = [r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel + 255 * amount))));
  return rgbToHex(next);
}

export function mix(hex, other, weight) {
  const [r, g, b] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(other);
  const channel = (a, c) => Math.round(a * (1 - weight) + c * weight);
  return rgbToHex([channel(r, r2), channel(g, g2), channel(b, b2)]);
}

export function contrast(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.36 ? "#1b1404" : "#ffffff";
}

export function applyTheme(settings = {}) {
  const preset = THEME_PRESETS[settings.themePreset] || null;
  const primary = normalizeHex(settings.themePrimary) || preset?.primary || "#d4a017";
  const secondary = normalizeHex(settings.themeSecondary) || preset?.secondary || "#111111";
  const root = document.documentElement;
  const soft = mix(primary, "#ffffff", 0.86);
  const sidebarText = contrast(secondary);
  root.style.setProperty("--primary-color", primary);
  root.style.setProperty("--primary-hover", shade(primary, -0.16));
  root.style.setProperty("--secondary-color", secondary);
  root.style.setProperty("--sidebar-color", secondary);
  root.style.setProperty("--sidebar-text", sidebarText);
  root.style.setProperty("--primary-soft", soft);
  root.style.setProperty("--on-primary", contrast(primary));
  root.style.setProperty("--focus-ring", hexToRgba(primary, 0.22));
  root.style.setProperty("--nav-hover", mix(secondary, sidebarText, 0.14));
  root.style.setProperty("--nav-active", mix(secondary, primary, 0.28));
  root.style.setProperty("--sidebar-muted", mix(sidebarText, secondary, 0.38));
  root.style.setProperty("--table-head", soft);
  root.dataset.theme = settings.themePreset || "custom";
}

function normalizeHex(value) {
  const text = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : "";
}

function hexToRgb(hex) {
  const clean = normalizeHex(hex) || "#000000";
  return [1, 3, 5].map((start) => Number.parseInt(clean.slice(start, start + 2), 16));
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
