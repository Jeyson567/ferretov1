import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAbono,
  applyAdjustment,
  computeQuote,
  computeReturn,
  computeSale,
  computeVoid,
  saleNet,
  stockFlags,
  toCents,
  weightedCost
} from "../js/calc.js";
import { agingBucket, dateKeyFrom, daysBetween, monthRange } from "../js/dates.js";

const item = (overrides = {}) => ({
  name: "Cemento",
  qty: 10,
  unitPrice: 50,
  discount: 0,
  cost: 35,
  factor: 1,
  manual: false,
  ...overrides
});

test("venta en efectivo cuadra total, pago y ganancia", () => {
  const sale = computeSale({
    items: [item()],
    payments: [{ methodCode: "cash", methodName: "Efectivo", amount: 500 }]
  });
  assert.equal(sale.total, 500);
  assert.equal(sale.paid, 500);
  assert.equal(sale.balance, 0);
  assert.equal(sale.paymentStatus, "paid");
  assert.equal(sale.costTotal, 350);
  assert.equal(saleNet(sale).profit, 150);
});

test("venta por transferencia queda pagada sin saldo", () => {
  const sale = computeSale({
    items: [item({ qty: 2, unitPrice: 80, cost: 50 })],
    payments: [{ methodCode: "transfer", methodName: "Transferencia", amount: 160 }]
  });
  assert.equal(sale.paymentStatus, "paid");
  assert.equal(sale.balance, 0);
  assert.equal(sale.paid, 160);
});

test("pago mixto separa lo recibido del crédito", () => {
  const sale = computeSale({
    items: [item({ qty: 1, unitPrice: 1500, cost: 1000 })],
    payments: [
      { methodCode: "cash", amount: 500 },
      { methodCode: "transfer", amount: 500 },
      { methodCode: "credit", amount: 500 }
    ]
  });
  assert.equal(sale.total, 1500);
  assert.equal(sale.paid, 1000);
  assert.equal(sale.balance, 500);
  assert.equal(sale.paymentStatus, "partial");
});

test("venta solo al crédito deja el total pendiente", () => {
  const sale = computeSale({
    items: [item({ qty: 4, unitPrice: 25, cost: 10 })],
    payments: [{ methodCode: "credit", amount: 100 }]
  });
  assert.equal(sale.paymentStatus, "credit");
  assert.equal(sale.balance, 100);
  assert.equal(sale.paid, 0);
});

test("los pagos que no cuadran con el total se rechazan", () => {
  assert.throws(() => computeSale({
    items: [item({ qty: 1, unitPrice: 100, cost: 40 })],
    payments: [{ methodCode: "cash", amount: 90 }]
  }), /igual al total/);
});

test("un abono reduce el saldo y no lo deja negativo", () => {
  const first = applyAbono(500, 200);
  assert.equal(first.balance, 300);
  assert.equal(first.status, "partial");
  const last = applyAbono(first.balance, 300);
  assert.equal(last.balance, 0);
  assert.equal(last.status, "paid");
  assert.throws(() => applyAbono(50, 60), /supera el saldo/);
});

test("la devolución de un crédito reduce el saldo antes de reembolsar", () => {
  const sale = {
    status: "completed",
    subtotal: 1500,
    total: 1500,
    paid: 1000,
    balance: 500,
    returnedAmount: 0,
    returnedCost: 0,
    refunded: 0,
    items: [{ name: "Varilla", qty: 15, lineTotal: 1500, cost: 70, returnedQty: 0 }]
  };
  const result = computeReturn(sale, [{ index: 0, qty: 6 }]);
  assert.equal(result.returnAmount, 600);
  assert.equal(result.creditReduction, 500);
  assert.equal(result.refundAmount, 100);
  assert.equal(result.nextBalance, 0);
});

test("una devolución de contado genera reembolso y repone la utilidad", () => {
  const sale = computeSale({
    items: [item()],
    payments: [{ methodCode: "cash", amount: 500 }]
  });
  const result = computeReturn(sale, [{ index: 0, qty: 4 }]);
  assert.equal(result.returnAmount, 200);
  assert.equal(result.refundAmount, 200);
  assert.equal(result.creditReduction, 0);
  const net = saleNet({ ...sale, returnedAmount: result.returnAmount, returnedCost: result.returnCost });
  assert.equal(net.sold, 300);
  assert.equal(net.profit, 90);
});

test("anular una venta pagada calcula el reembolso pendiente", () => {
  const plan = computeVoid({ status: "completed", paid: 800, refunded: 100, balance: 200 });
  assert.equal(plan.refundNow, 700);
  assert.equal(plan.balanceCancel, 200);
  assert.equal(saleNet({ status: "void", total: 800, costTotal: 500 }).sold, 0);
});

test("no permite existencias negativas si la configuración lo impide", () => {
  assert.throws(() => applyAdjustment(5, 8, "out", false), /negativas/);
  const allowed = applyAdjustment(5, 8, "out", true);
  assert.equal(allowed.next, -3);
  const entry = applyAdjustment(5, 2, "in", false);
  assert.equal(entry.next, 7);
});

test("la entrada de inventario usa costo promedio ponderado", () => {
  const result = weightedCost(10, 20, 10, 40);
  assert.equal(result.stock, 20);
  assert.equal(result.cost, 30);
  assert.equal(weightedCost(0, 0, 5, 18).cost, 18);
});

test("la cotización calcula descuentos sin convertirse en venta", () => {
  const quote = computeQuote({
    items: [{ name: "Clavo", qty: 2, unitPrice: 15, discount: 5 }, { name: "Manual", qty: 1, unitPrice: 20, discount: 0 }],
    globalDiscount: 10
  });
  assert.equal(quote.subtotal, 45);
  assert.equal(quote.total, 35);
});

test("un descuento mayor que la línea se rechaza", () => {
  assert.throws(() => computeSale({
    items: [item({ qty: 1, unitPrice: 10, discount: 12, cost: 4 })],
    payments: [{ methodCode: "cash", amount: 0 }]
  }), /descuento/);
});

test("la venta por unidad convertida descuenta la existencia base", () => {
  const sale = computeSale({
    items: [item({ qty: 2, factor: 100, unitPrice: 80, cost: 50 })],
    payments: [{ methodCode: "cash", amount: 160 }]
  });
  assert.equal(sale.items[0].baseQty, 200);
});

test("la fecha de Guatemala no usa el día UTC cuando aún es de noche", () => {
  assert.equal(dateKeyFrom(new Date("2026-11-01T04:30:00Z")), "2026-10-31");
  assert.equal(dateKeyFrom(new Date("2026-11-01T06:30:00Z")), "2026-11-01");
  assert.equal(daysBetween("2026-10-01", "2026-10-31"), 30);
  assert.equal(monthRange("2026-10-15").start, "2026-10-01");
  assert.equal(monthRange("2026-10-15").end, "2026-10-31");
});

test("la antigüedad del saldo usa la fecha de vencimiento", () => {
  assert.equal(agingBucket("2026-10-31", "2026-10-31"), "al_dia");
  assert.equal(agingBucket("2026-10-01", "2026-10-31"), "1_30");
  assert.equal(agingBucket("2026-08-01", "2026-10-31"), "mas_90");
});

test("las alertas de inventario comparan existencia contra el mínimo", () => {
  assert.deepEqual(stockFlags(0, 5), { lowStock: true, outOfStock: true });
  assert.deepEqual(stockFlags(5, 5), { lowStock: true, outOfStock: false });
  assert.deepEqual(stockFlags(6, 5), { lowStock: false, outOfStock: false });
  assert.equal(toCents(10.1) + toCents(0.2), toCents(10.3));
});
