export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function roundQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export function toCents(value) {
  return Math.round((roundMoney(value) + Number.EPSILON) * 100);
}

export function paymentStatus(paid, balance) {
  if (toCents(balance) <= 0) return "paid";
  if (toCents(paid) <= 0) return "credit";
  return "partial";
}

export function discountRate(gross, discountTotal) {
  const base = roundMoney(gross);
  if (toCents(base) <= 0) return 0;
  return (roundMoney(discountTotal) / base) * 100;
}

export function computeSale({ items, globalDiscount = 0, payments }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agregue al menos un producto a la venta.");
  }
  if (items.length > 80) throw new Error("La venta admite como máximo 80 líneas.");

  const norm = items.map((item, index) => {
    const qty = roundQty(item.qty);
    if (!(qty > 0)) throw new Error(`La cantidad de la línea ${index + 1} debe ser mayor que cero.`);
    const unitPrice = roundMoney(item.unitPrice);
    if (unitPrice < 0) throw new Error(`El precio de la línea ${index + 1} no es válido.`);
    const gross = roundMoney(qty * unitPrice);
    const discount = roundMoney(item.discount || 0);
    if (discount < 0) throw new Error("El descuento no puede ser negativo.");
    if (toCents(discount) > toCents(gross)) {
      throw new Error(`El descuento de «${item.name || "la línea"}» supera el importe.`);
    }
    const lineTotal = roundMoney(gross - discount);
    const cost = roundMoney(item.cost || 0);
    const factor = roundQty(item.factor || 1);
    if (!(factor > 0)) throw new Error(`La unidad de «${item.name || "la línea"}» no es válida.`);
    return {
      ...item,
      qty,
      unitPrice,
      discount,
      lineTotal,
      cost,
      factor,
      baseQty: item.manual ? qty : roundQty(qty * factor),
      returnedQty: 0
    };
  });

  const gross = roundMoney(norm.reduce((sum, item) => sum + roundMoney(item.qty * item.unitPrice), 0));
  const lineDiscounts = roundMoney(norm.reduce((sum, item) => sum + item.discount, 0));
  const subtotal = roundMoney(norm.reduce((sum, item) => sum + item.lineTotal, 0));
  const discount = roundMoney(globalDiscount || 0);
  if (discount < 0) throw new Error("El descuento general no puede ser negativo.");
  if (toCents(discount) > toCents(subtotal)) {
    throw new Error("El descuento general supera el subtotal.");
  }
  const total = roundMoney(subtotal - discount);
  const costTotal = roundMoney(norm.reduce((sum, item) => sum + roundMoney(item.cost * item.qty), 0));
  const pays = (payments || []).map((payment) => ({
    ...payment,
    amount: roundMoney(payment.amount)
  }));
  if (!pays.length) throw new Error("Registre al menos un método de pago.");
  if (pays.length > 8) throw new Error("Solo se permiten 8 pagos por venta.");
  if (pays.some((payment) => !(payment.amount > 0))) {
    throw new Error("Cada pago debe ser mayor que cero.");
  }
  const paidSum = roundMoney(pays.reduce((sum, payment) => sum + payment.amount, 0));
  if (toCents(paidSum) !== toCents(total)) {
    throw new Error("La suma de los pagos debe ser igual al total.");
  }
  const balance = roundMoney(
    pays.filter((payment) => payment.methodCode === "credit").reduce((sum, payment) => sum + payment.amount, 0)
  );
  const paid = roundMoney(total - balance);
  return {
    items: norm,
    gross,
    lineDiscounts,
    subtotal,
    discount,
    discountTotal: roundMoney(lineDiscounts + discount),
    total,
    costTotal,
    payments: pays,
    paid,
    balance,
    returnedAmount: 0,
    returnedCost: 0,
    refunded: 0,
    paymentStatus: paymentStatus(paid, balance)
  };
}

export function computeQuote({ items, globalDiscount = 0 }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agregue al menos una partida a la cotización.");
  }
  const draft = items.map((item, index) => {
    const qty = roundQty(item.qty);
    if (!(qty > 0)) throw new Error(`La cantidad de la línea ${index + 1} debe ser mayor que cero.`);
    if (!String(item.name || "").trim()) throw new Error(`La línea ${index + 1} necesita un nombre.`);
    const unitPrice = roundMoney(item.unitPrice);
    if (unitPrice < 0) throw new Error(`El precio de la línea ${index + 1} no es válido.`);
    const gross = roundMoney(qty * unitPrice);
    const discount = roundMoney(item.discount || 0);
    if (discount < 0 || toCents(discount) > toCents(gross)) {
      throw new Error(`El descuento de «${item.name}» no es válido.`);
    }
    return { ...item, qty, unitPrice, discount, lineTotal: roundMoney(gross - discount) };
  });
  const subtotal = roundMoney(draft.reduce((sum, item) => sum + item.lineTotal, 0));
  const discount = roundMoney(globalDiscount || 0);
  if (discount < 0 || toCents(discount) > toCents(subtotal)) {
    throw new Error("El descuento general de la cotización no es válido.");
  }
  return { items: draft, subtotal, discount, total: roundMoney(subtotal - discount) };
}

export function computeReturn(sale, lines) {
  if (!sale || sale.status === "void") throw new Error("La venta anulada no admite devoluciones.");
  if (!Array.isArray(lines) || !lines.length) throw new Error("Seleccione los productos a devolver.");
  const items = sale.items.map((item) => ({ ...item, returnedQty: roundQty(item.returnedQty || 0) }));
  let returnAmount = 0;
  let returnCost = 0;
  const proportion = toCents(sale.subtotal) > 0 ? sale.total / sale.subtotal : 1;
  const used = new Set();
  for (const line of lines) {
    if (used.has(line.index)) throw new Error("Hay una línea de devolución repetida.");
    used.add(line.index);
    const item = items[line.index];
    if (!item) throw new Error("Una línea de la devolución no pertenece a la venta.");
    const qty = roundQty(line.qty);
    const available = roundQty(item.qty - item.returnedQty);
    if (!(qty > 0)) throw new Error("La cantidad devuelta debe ser mayor que cero.");
    if (qty - available > 0.0001) {
      throw new Error(`Solo puede devolver ${available} de «${item.name}».`);
    }
    const perUnit = item.qty ? item.lineTotal / item.qty : 0;
    returnAmount += roundMoney(perUnit * qty * proportion);
    returnCost += roundMoney((item.cost || 0) * qty);
    item.returnedQty = roundQty(item.returnedQty + qty);
  }
  returnAmount = roundMoney(returnAmount);
  returnCost = roundMoney(returnCost);
  const remainingValue = roundMoney((sale.total || 0) - (sale.returnedAmount || 0));
  if (toCents(returnAmount) > toCents(remainingValue)) returnAmount = remainingValue;
  const balance = roundMoney(sale.balance || 0);
  const creditReduction = roundMoney(Math.min(balance, returnAmount));
  const refundAmount = roundMoney(returnAmount - creditReduction);
  const allReturned = items.every((item) => roundQty(item.qty - item.returnedQty) <= 0);
  return {
    items,
    returnAmount,
    returnCost,
    creditReduction,
    refundAmount,
    nextBalance: roundMoney(balance - creditReduction),
    nextReturnedAmount: roundMoney((sale.returnedAmount || 0) + returnAmount),
    nextReturnedCost: roundMoney((sale.returnedCost || 0) + returnCost),
    nextRefunded: roundMoney((sale.refunded || 0) + refundAmount),
    status: allReturned ? "returned" : "partial_return"
  };
}

export function applyAbono(balance, amount) {
  const current = roundMoney(balance);
  const payment = roundMoney(amount);
  if (!(payment > 0)) throw new Error("El abono debe ser mayor que cero.");
  if (toCents(current) <= 0) throw new Error("Esta cuenta ya está pagada.");
  if (toCents(payment) > toCents(current)) {
    throw new Error("El abono supera el saldo pendiente.");
  }
  const next = roundMoney(current - payment);
  return {
    amount: payment,
    balance: next,
    status: toCents(next) === 0 ? "paid" : "partial"
  };
}

export function computeVoid(sale) {
  if (!sale || sale.status === "void") throw new Error("La venta ya está anulada.");
  const refundNow = roundMoney(Math.max(0, (sale.paid || 0) - (sale.refunded || 0)));
  return {
    refundNow,
    balanceCancel: roundMoney(sale.balance || 0)
  };
}

export function weightedCost(oldStock, oldCost, qty, cost) {
  const add = roundQty(qty);
  const purchase = roundMoney(cost);
  if (!(add > 0)) throw new Error("La cantidad de la entrada debe ser mayor que cero.");
  if (purchase < 0) throw new Error("El costo no puede ser negativo.");
  const stock = roundQty(oldStock || 0);
  const nextStock = roundQty(stock + add);
  if (stock <= 0) return { stock: nextStock, cost: purchase };
  return {
    stock: nextStock,
    cost: roundMoney((stock * roundMoney(oldCost || 0) + add * purchase) / (stock + add))
  };
}

export function applyAdjustment(stock, qty, direction, allowNegative) {
  const amount = roundQty(qty);
  if (!(amount > 0)) throw new Error("La cantidad debe ser mayor que cero.");
  if (direction !== "in" && direction !== "out") throw new Error("El tipo de ajuste no es válido.");
  const prev = roundQty(stock || 0);
  const next = direction === "out" ? roundQty(prev - amount) : roundQty(prev + amount);
  if (direction === "out" && next < -0.0001 && !allowNegative) {
    throw new Error("El ajuste dejaría existencias negativas y esa opción está desactivada.");
  }
  return { prev, next, signed: direction === "out" ? -amount : amount };
}

export function stockFlags(stock, minStock) {
  const next = roundQty(stock);
  const min = Number(minStock || 0);
  return { lowStock: next <= min, outOfStock: next <= 0 };
}

export function saleNet(sale) {
  if (!sale || sale.status === "void") {
    return { sold: 0, cost: 0, profit: 0 };
  }
  const sold = roundMoney((sale.total || 0) - (sale.returnedAmount || 0));
  const cost = roundMoney((sale.costTotal || 0) - (sale.returnedCost || 0));
  return { sold, cost, profit: roundMoney(sold - cost) };
}
