export const DEFAULT_UNITS = [
  ["unidad", "Unidad", "und"],
  ["bolsa", "Bolsa", "bolsa"],
  ["saco", "Saco", "saco"],
  ["quintal", "Quintal", "qq"],
  ["libra", "Libra", "lb"],
  ["kilogramo", "Kilogramo", "kg"],
  ["metro", "Metro", "m"],
  ["metro-cuadrado", "Metro cuadrado", "m²"],
  ["metro-cubico", "Metro cúbico", "m³"],
  ["litro", "Litro", "L"],
  ["galon", "Galón", "gal"],
  ["caja", "Caja", "caja"],
  ["docena", "Docena", "doc"],
  ["pieza", "Pieza", "pza"],
  ["varilla", "Varilla", "var"],
  ["rollo", "Rollo", "rollo"]
];

export const DEFAULT_METHODS = [
  ["efectivo", "Efectivo", "cash", false, true],
  ["transferencia", "Transferencia bancaria", "transfer", true, false],
  ["tarjeta", "Tarjeta", "card", true, false],
  ["deposito", "Depósito", "deposit", true, false],
  ["credito", "Crédito", "credit", false, true],
  ["otro", "Otro", "other", false, false]
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  ["alquiler", "Alquiler"],
  ["electricidad", "Electricidad"],
  ["agua", "Agua"],
  ["internet", "Internet"],
  ["transporte", "Transporte"],
  ["salarios", "Salarios"],
  ["mantenimiento", "Mantenimiento"],
  ["otros", "Otros"]
];

export function defaultSettings(business) {
  return {
    businessName: business.businessName || "FERRETOV",
    address: business.address || "",
    phone: business.phone || "",
    whatsapp: business.whatsapp || "",
    nit: business.nit || "",
    country: "Guatemala",
    currency: "GTQ",
    currencySymbol: "Q",
    timezone: "America/Guatemala",
    dateFormat: "DD/MM/YYYY",
    printFormat: "letter",
    allowNegativeStock: false,
    defaultMinStock: 5,
    maxDiscountPercent: 15,
    allowSellerPriceEdit: true,
    logoUrl: "",
    email: business.email || "",
    ticketFooter: business.ticketFooter || "Gracias por su compra.",
    receiptNote: business.receiptNote || "",
    themePreset: "ferretov",
    themePrimary: "#d4a017",
    themeSecondary: "#111111"
  };
}
