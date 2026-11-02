import { money, phoneDigits, roundMoney } from "./utils.js";

function compact(value) {
  const amount = roundMoney(value || 0).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `Q${amount}`;
}

export function openWhatsApp(phone, message) {
  const digits = phoneDigits(phone);
  if (digits.length < 11) throw new Error("Registre un WhatsApp válido. En Guatemala puede usar 8 dígitos.");
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener");
}

export function quoteText(quote) {
  return `Hola, ${quote.customerName}. Te compartimos la cotización número ${quote.number}, con un total de ${compact(quote.total)}. Gracias por preferirnos.`;
}

export function balanceText(name, balance) {
  return `Hola, ${name}. Te recordamos que actualmente tienes un saldo pendiente de ${compact(balance)} en nuestra ferretería. Estamos a tus órdenes.`;
}

export function paymentText(name, amount, balance) {
  return `Hola, ${name}. Hemos registrado tu abono de ${compact(amount)}. Tu saldo pendiente es de ${compact(balance)}.`;
}

export function saleText(sale) {
  const pending = roundMoney(sale.balance || 0) > 0
    ? ` Tu saldo pendiente es de ${compact(sale.balance)}.`
    : "";
  return `Hola, ${sale.customerName}. Registramos tu compra ${sale.number} por ${compact(sale.total)}.${pending} Gracias por preferirnos.`;
}

export { money };
