import { db, storage } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  limit,
  orderBy,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { getSession } from "./auth.js";
import { assertCan, can } from "./permissions.js";
import { getSettings } from "./state.js";
import {
  applyAbono,
  applyAdjustment,
  computeQuote,
  computeReturn,
  computeSale,
  computeVoid,
  discountRate,
  paymentStatus,
  roundMoney,
  roundQty,
  stockFlags,
  toCents,
  weightedCost
} from "./calc.js";
import { dateKey, keyToDate, padNumber, normalize } from "./utils.js";

function requireUser() {
  const session = getSession();
  if (!session) throw new Error("Debe iniciar sesión para continuar.");
  return session;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, clean(item)])
    );
  }
  return value;
}

function auditPayload(action, moduleName, entityId, summary) {
  const session = requireUser();
  return {
    action,
    module: moduleName,
    entityId: entityId || null,
    summary: summary || "",
    userId: session.uid,
    userName: session.name,
    at: Date.now(),
    createdAt: Timestamp.now()
  };
}

function movementPayload(data) {
  const session = requireUser();
  const now = Timestamp.now();
  return clean({
    ...data,
    userId: session.uid,
    userName: session.name,
    date: now,
    at: Date.now(),
    dateKey: data.dateKey || dateKey()
  });
}

function resolveUnit(product, unitId) {
  if (!unitId || unitId === product.unitId) {
    return { unitId: product.unitId, unitName: product.unitName || "Unidad", factor: 1 };
  }
  const found = (product.conversions || []).find((item) => item.unitId === unitId);
  if (!found || !(Number(found.factor) > 0)) {
    throw new Error(`La unidad seleccionada no está habilitada para ${product.name}.`);
  }
  return { unitId: found.unitId, unitName: found.unitName, factor: roundQty(found.factor) };
}

function imageContentType(file) {
  if (file.type?.startsWith("image/")) return file.type;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  return "";
}

async function uploadImage(path, file) {
  if (!file) return "";
  const contentType = imageContentType(file);
  if (!contentType) throw new Error("Seleccione una imagen PNG o JPG.");
  if (file.size > 2 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 2 MB.");
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType });
  return getDownloadURL(storageRef);
}

export async function saveSettings(patch, logoFile) {
  requireUser();
  const keys = Object.keys(patch || {}).filter((key) => !["updatedAt", "country", "currency", "currencySymbol", "timezone", "dateFormat"].includes(key));
  const themeKeys = ["themePreset", "themePrimary", "themeSecondary"];
  const onlyTheme = keys.length > 0 && keys.every((key) => themeKeys.includes(key));
  if (onlyTheme) {
    if (!can("settings.colors")) assertCan("settings.business");
  } else if (keys.length || logoFile) assertCan("settings.business");
  const next = { ...patch, updatedAt: Timestamp.now() };
  if (logoFile) next.logoUrl = await uploadImage(`branding/logo-${Date.now()}`, logoFile);
  await setDoc(doc(db, "settings", "general"), clean(next), { merge: true });
}

export async function saveCatalogItem(collectionName, id, data) {
  requireUser();
  const needed = {
    categories: "settings.categories",
    units: "settings.units",
    paymentMethods: "settings.methods",
    expenseCategories: "settings.categories"
  };
  assertCan(needed[collectionName] || "settings.business");
  const refId = id || doc(collection(db, collectionName)).id;
  await setDoc(doc(db, collectionName, refId), clean({
    ...data,
    updatedAt: Timestamp.now(),
    createdAt: data.createdAt || Timestamp.now()
  }), { merge: true });
  return refId;
}

export async function createInvite({ email, name, role }) {
  const session = requireUser();
  const emailId = normalize(email);
  if (!emailId.includes("@")) throw new Error("Escriba un correo válido.");
  if (!["admin", "seller", "inventory"].includes(role)) throw new Error("Seleccione un rol válido.");
  await setDoc(doc(db, "invites", emailId), {
    email: emailId,
    name: name.trim(),
    role,
    accepted: false,
    createdBy: session.uid,
    createdAt: Timestamp.now()
  });
}

export async function updateUserAccount() {
  throw new Error("Los usuarios se administran en Usuarios y permisos.");
}

export async function updateOwnName(name) {
  const session = requireUser();
  if (!name.trim()) throw new Error("Escriba su nombre.");
  await updateDoc(doc(db, "users", session.uid), {
    name: name.trim(),
    updatedAt: Timestamp.now()
  });
  session.name = name.trim();
}

export async function saveProduct(input, imageFile) {
  const session = requireUser();
  if (input.id) assertCan("inventory.edit");
  else assertCan("inventory.create");
  const productRef = input.id ? doc(db, "products", input.id) : doc(collection(db, "products"));
  await runTransaction(db, async (transaction) => {
    const codeKey = normalize(input.code);
    if (!codeKey) throw new Error("El código del producto es obligatorio.");
    if (!String(input.name || "").trim()) throw new Error("El nombre del producto es obligatorio.");
    if (!input.unitId) throw new Error("Seleccione la unidad de medida.");
    const codeRef = doc(db, "productCodes", codeKey);
    const codeSnap = await transaction.get(codeRef);
    if (codeSnap.exists() && codeSnap.data().productId !== productRef.id) {
      throw new Error("Ya existe un producto con ese código.");
    }
    let existing = null;
    if (input.id) {
      const current = await transaction.get(productRef);
      if (!current.exists()) throw new Error("El producto ya no existe.");
      existing = current.data();
    }
    const barcode = String(input.barcode || "").trim();
    let barcodeRef = null;
    if (barcode) {
      barcodeRef = doc(db, "barcodes", barcode);
      const barcodeSnap = await transaction.get(barcodeRef);
      if (barcodeSnap.exists() && barcodeSnap.data().productId !== productRef.id) {
        throw new Error("Ese código de barras ya está registrado.");
      }
    }
    const now = Timestamp.now();
    const stock = existing ? roundQty(existing.stock || 0) : roundQty(input.stock || 0);
    if (stock < 0) throw new Error("La existencia inicial no puede ser negativa.");
    const minStock = roundQty(input.minStock ?? getSettings().defaultMinStock ?? 0);
    const flags = stockFlags(stock, minStock);
    const active = input.active !== false;
    if (existing && existing.active !== active && !can("inventory.delete")) {
      throw new Error("No tiene permiso para desactivar o activar productos.");
    }
    const data = {
      code: input.code.trim(),
      codeLower: codeKey,
      barcode,
      name: input.name.trim(),
      nameLower: normalize(input.name),
      description: input.description?.trim() || "",
      categoryId: input.categoryId || "",
      categoryName: input.categoryName || "",
      brand: input.brand?.trim() || "",
      unitId: input.unitId,
      unitName: input.unitName,
      conversions: (input.conversions || []).map((item) => ({
        unitId: item.unitId,
        unitName: item.unitName,
        factor: roundQty(item.factor)
      })),
      cost: !can("inventory.viewCosts") ? roundMoney(existing?.cost || 0) : roundMoney(input.cost),
      price: existing && !can("inventory.viewPrices") ? roundMoney(existing.price || 0) : roundMoney(input.price),
      wholesalePrice: existing && !can("inventory.viewPrices")
        ? existing.wholesalePrice ?? null
        : input.wholesalePrice === "" || input.wholesalePrice == null
        ? null
        : roundMoney(input.wholesalePrice),
      stock,
      minStock,
      lowStock: active ? flags.lowStock : false,
      outOfStock: active ? flags.outOfStock : false,
      supplierId: input.supplierId || "",
      supplierName: input.supplierName || "",
      imageUrl: existing?.imageUrl || "",
      active,
      updatedAt: now,
      updatedBy: session.uid
    };
    if (data.cost < 0 || data.price < 0 || (data.wholesalePrice != null && data.wholesalePrice < 0)) {
      throw new Error("Los precios y el costo no pueden ser negativos.");
    }
    if (!existing) {
      data.createdAt = now;
      data.createdBy = session.uid;
    }
    transaction.set(productRef, clean(data), { merge: true });
    if (existing && normalize(existing.code) !== codeKey) {
      transaction.delete(doc(db, "productCodes", normalize(existing.code)));
    }
    transaction.set(codeRef, { productId: productRef.id, code: data.code });
    if (existing?.barcode && existing.barcode !== barcode) {
      transaction.delete(doc(db, "barcodes", existing.barcode));
    }
    if (barcodeRef) transaction.set(barcodeRef, { productId: productRef.id });
    if (!existing && stock > 0) {
      transaction.set(doc(collection(db, "inventoryMovements")), movementPayload({
        productId: productRef.id,
        productName: data.name,
        productCode: data.code,
        type: "initial",
        quantity: stock,
        previousStock: 0,
        newStock: stock,
        unitName: data.unitName,
        reason: "Inventario inicial",
        referenceType: "product",
        referenceId: productRef.id,
        referenceNumber: data.code
      }));
    }
    transaction.set(doc(collection(db, "auditLogs")), auditPayload(
      existing ? "product.update" : "product.create",
      "inventario",
      productRef.id,
      data.name
    ));
  });
  if (imageFile) {
    const imageUrl = await uploadImage(`products/${productRef.id}/${Date.now()}`, imageFile);
    await updateDoc(productRef, { imageUrl, updatedAt: Timestamp.now() });
  }
  return productRef.id;
}

export async function setProductActive(productId, active) {
  requireUser();
  assertCan("inventory.delete");
  await runTransaction(db, async (transaction) => {
    const refId = doc(db, "products", productId);
    const snap = await transaction.get(refId);
    if (!snap.exists()) throw new Error("El producto no existe.");
    const product = snap.data();
    const flags = active ? stockFlags(product.stock || 0, product.minStock || 0) : { lowStock: false, outOfStock: false };
    transaction.update(refId, {
      active,
      lowStock: flags.lowStock,
      outOfStock: flags.outOfStock,
      updatedAt: Timestamp.now()
    });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload(
      active ? "product.activate" : "product.deactivate",
      "inventario",
      productId,
      product.name
    ));
  });
}

export async function adjustStock({ productId, qty, direction, reason }) {
  requireUser();
  assertCan(direction === "out" ? "inventory.decreaseStock" : "inventory.increaseStock");
  if (!reason || reason.trim().length < 3) throw new Error("Escriba el motivo del ajuste.");
  await runTransaction(db, async (transaction) => {
    const settingsSnap = await transaction.get(doc(db, "settings", "general"));
    const refId = doc(db, "products", productId);
    const snap = await transaction.get(refId);
    if (!snap.exists()) throw new Error("El producto no existe.");
    const product = snap.data();
    if (product.active === false) throw new Error("Active el producto antes de ajustar existencias.");
    const result = applyAdjustment(product.stock, qty, direction, settingsSnap.data()?.allowNegativeStock === true);
    const flags = stockFlags(result.next, product.minStock || 0);
    const now = Timestamp.now();
    transaction.update(refId, {
      stock: result.next,
      lowStock: flags.lowStock,
      outOfStock: flags.outOfStock,
      updatedAt: now
    });
    transaction.set(doc(collection(db, "inventoryMovements")), movementPayload({
      productId,
      productName: product.name,
      productCode: product.code,
      type: "adjustment",
      quantity: result.signed,
      previousStock: result.prev,
      newStock: result.next,
      unitName: product.unitName,
      reason: reason.trim(),
      referenceType: "adjustment",
      referenceId: productId,
      referenceNumber: product.code
    }));
    transaction.set(doc(collection(db, "auditLogs")), auditPayload("stock.adjust", "inventario", productId, product.name));
  });
}

export async function createStockEntry(input) {
  const session = requireUser();
  assertCan("suppliers.entries");
  if (!input.requestId) throw new Error("No se pudo identificar la operación.");
  if (!input.items?.length) throw new Error("Agregue los productos de la entrada.");
  const entryRef = doc(collection(db, "stockEntries"));
  return runTransaction(db, async (transaction) => {
    const idemRef = doc(db, "idempotency", input.requestId);
    const idemSnap = await transaction.get(idemRef);
    if (idemSnap.exists()) return idemSnap.data().entryId;
    const counterRef = doc(db, "counters", "main");
    const counterSnap = await transaction.get(counterRef);
    const uniqueIds = [...new Set(input.items.map((item) => item.productId))];
    const products = new Map();
    for (const productId of uniqueIds) {
      const snap = await transaction.get(doc(db, "products", productId));
      if (!snap.exists()) throw new Error("Uno de los productos ya no existe.");
      products.set(productId, snap);
    }
    const now = Timestamp.now();
    const day = input.dateKey || dateKey();
    const number = padNumber("ENT", (counterSnap.data()?.entry || 0) + 1);
    const lines = [];
    const totals = new Map();
    input.items.forEach((item) => {
      const qty = roundQty(item.qty);
      const cost = roundMoney(item.cost);
      if (!(qty > 0)) throw new Error("Cada cantidad debe ser mayor que cero.");
      const current = totals.get(item.productId) || { qty: 0, value: 0 };
      current.qty = roundQty(current.qty + qty);
      current.value = roundMoney(current.value + roundMoney(qty * cost));
      totals.set(item.productId, current);
      const product = products.get(item.productId).data();
      lines.push({
        productId: item.productId,
        name: product.name,
        code: product.code,
        unitName: product.unitName,
        qty,
        cost,
        lineTotal: roundMoney(qty * cost)
      });
    });
    transaction.set(counterRef, { entry: (counterSnap.data()?.entry || 0) + 1 }, { merge: true });
    for (const [productId, total] of totals) {
      const snap = products.get(productId);
      const product = snap.data();
      const average = weightedCost(product.stock, product.cost, total.qty, roundMoney(total.value / total.qty));
      const flags = stockFlags(average.stock, product.minStock || 0);
      const patch = {
        stock: average.stock,
        cost: average.cost,
        lowStock: product.active === false ? false : flags.lowStock,
        outOfStock: product.active === false ? false : flags.outOfStock,
        updatedAt: now
      };
      if (input.setAsMainSupplier && input.supplierId) {
        patch.supplierId = input.supplierId;
        patch.supplierName = input.supplierName || "";
      }
      transaction.update(snap.ref, patch);
      transaction.set(doc(collection(db, "inventoryMovements")), movementPayload({
        productId,
        productName: product.name,
        productCode: product.code,
        type: "entry",
        quantity: total.qty,
        previousStock: roundQty(product.stock || 0),
        newStock: average.stock,
        unitName: product.unitName,
        reason: "Entrada de proveedor",
        referenceType: "entry",
        referenceId: entryRef.id,
        referenceNumber: number,
        dateKey: day
      }));
    }
    const total = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    transaction.set(entryRef, clean({
      number,
      supplierId: input.supplierId || "",
      supplierName: input.supplierName || "Sin proveedor",
      reference: input.reference || "",
      notes: input.notes || "",
      date: Timestamp.fromDate(keyToDate(day)),
      dateKey: day,
      at: Date.now(),
      items: lines,
      total,
      userId: session.uid,
      userName: session.name,
      createdAt: now
    }));
    transaction.set(idemRef, { entryId: entryRef.id, uid: session.uid, type: "entry", createdAt: now });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload("entry.create", "inventario", entryRef.id, number));
    return entryRef.id;
  });
}

export async function finalizeSale(input) {
  const session = requireUser();
  assertCan("pos.create");
  if (input.quoteId) assertCan("quotes.convert");
  if (!can("pos.payments")) throw new Error("No tiene permiso para registrar pagos.");
  if (!input.requestId) throw new Error("No se pudo identificar la venta.");
  const idemRef = doc(db, "idempotency", input.requestId);
  const saleRef = doc(collection(db, "sales"));
  const result = await runTransaction(db, async (transaction) => {
    const idemSnap = await transaction.get(idemRef);
    if (idemSnap.exists()) return { duplicate: true, saleId: idemSnap.data().saleId };
    const settingsSnap = await transaction.get(doc(db, "settings", "general"));
    const settings = settingsSnap.data() || getSettings();
    const counterRef = doc(db, "counters", "main");
    const counterSnap = await transaction.get(counterRef);
    let quoteRef = null;
    let quoteSnap = null;
    if (input.quoteId) {
      quoteRef = doc(db, "quotes", input.quoteId);
      quoteSnap = await transaction.get(quoteRef);
      if (!quoteSnap.exists()) throw new Error("La cotización no existe.");
      if (quoteSnap.data().status === "converted") throw new Error("La cotización ya fue convertida en una venta.");
    }
    let customerRef = null;
    let customerSnap = null;
    if (input.customerId) {
      customerRef = doc(db, "customers", input.customerId);
      customerSnap = await transaction.get(customerRef);
      if (!customerSnap.exists() || customerSnap.data().active === false) {
        throw new Error("Seleccione un cliente activo.");
      }
    }
    const productIds = [...new Set(input.items.filter((item) => item.productId).map((item) => item.productId))];
    const products = new Map();
    for (const productId of productIds) {
      const snap = await transaction.get(doc(db, "products", productId));
      if (!snap.exists()) throw new Error("Un producto de la venta ya no existe.");
      products.set(productId, snap);
    }
    const methods = new Map();
    for (const payment of input.payments || []) {
      if (methods.has(payment.methodId)) continue;
      const snap = await transaction.get(doc(db, "paymentMethods", payment.methodId));
      if (!snap.exists() || snap.data().active === false) throw new Error("Un método de pago no está disponible.");
      methods.set(payment.methodId, snap.data());
    }
    const resolvedItems = input.items.map((item) => {
      if (!item.productId) {
        if (!String(item.name || "").trim()) throw new Error("Una partida manual no tiene nombre.");
        return {
          manual: true,
          productId: null,
          code: "MANUAL",
          name: item.name.trim(),
          qty: item.qty,
          unitId: "",
          unitName: item.unitName || "Unidad",
          factor: 1,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          cost: 0
        };
      }
      const product = products.get(item.productId).data();
      if (product.active === false) throw new Error(`${product.name} está inactivo.`);
      const unit = resolveUnit(product, item.unitId);
      const listPrice = item.wholesale && product.wholesalePrice ? product.wholesalePrice : product.price;
      if (!can("pos.changePrice") && Math.abs(roundMoney(item.unitPrice) - roundMoney(listPrice || 0)) > 0.009) {
        throw new Error("No tiene permiso para modificar precios.");
      }
      if (!can("pos.discount") && roundMoney(item.discount || 0) > 0) {
        throw new Error("No tiene permiso para aplicar descuentos.");
      }
      return {
        manual: false,
        productId: item.productId,
        code: product.code,
        name: product.name,
        qty: item.qty,
        unitId: unit.unitId,
        unitName: unit.unitName,
        factor: unit.factor,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
        cost: roundMoney((product.cost || 0) * unit.factor)
      };
    });
    const payments = (input.payments || []).map((payment) => {
      const method = methods.get(payment.methodId);
      if (method.requiresReference && !String(payment.reference || "").trim()) {
        throw new Error(`Indique la referencia de ${method.name}.`);
      }
      return {
        methodId: payment.methodId,
        methodName: method.name,
        methodCode: method.code,
        amount: payment.amount,
        reference: String(payment.reference || "").trim()
      };
    });
    const computed = computeSale({ items: resolvedItems, globalDiscount: input.discount || 0, payments });
    if (!can("pos.discount") && roundMoney(input.discount || 0) > 0) {
      throw new Error("No tiene permiso para aplicar descuentos.");
    }
    if (!can("pos.credit") && (payments.some((payment) => payment.methodCode === "credit") || computed.balance > 0)) {
      throw new Error("No tiene permiso para registrar ventas al crédito.");
    }
    if (session.role !== "owner" && session.role !== "admin") {
      const max = Number(settings.maxDiscountPercent ?? 15);
      const rate = discountRate(computed.gross, computed.discountTotal);
      if (rate - max > 0.01) {
        throw new Error(`El descuento de ${rate.toFixed(1)}% supera el máximo permitido de ${max}%.`);
      }
    }
    if (toCents(computed.balance) > 0 && !customerRef) {
      throw new Error("Seleccione un cliente para registrar el saldo al crédito.");
    }
    if (toCents(computed.balance) > 0 && !input.dueDate) {
      throw new Error("Indique la fecha de pago del crédito.");
    }
    const needed = new Map();
    computed.items.forEach((item) => {
      if (!item.productId) return;
      needed.set(item.productId, roundQty((needed.get(item.productId) || 0) + item.baseQty));
    });
    for (const [productId, baseQty] of needed) {
      const product = products.get(productId).data();
      if (settings.allowNegativeStock !== true && roundQty(product.stock || 0) + 0.0001 < baseQty) {
        throw new Error(`Existencia insuficiente de ${product.name}. Disponible: ${roundQty(product.stock || 0)} ${product.unitName}.`);
      }
    }
    const cashApplied = roundMoney(computed.payments.filter((payment) => payment.methodCode === "cash").reduce((sum, payment) => sum + payment.amount, 0));
    const cashTendered = roundMoney(input.cashTendered || 0);
    if (toCents(cashApplied) > 0 && toCents(cashTendered) > 0 && toCents(cashTendered) < toCents(cashApplied)) {
      throw new Error("El efectivo entregado no cubre el monto en efectivo.");
    }
    const change = toCents(cashTendered) > 0 ? roundMoney(Math.max(0, cashTendered - cashApplied)) : 0;
    const number = padNumber("V", (counterSnap.data()?.sale || 0) + 1);
    const now = Timestamp.now();
    const day = dateKey();
    const customer = customerSnap?.data();
    const sale = {
      number,
      date: now,
      at: Date.now(),
      dateKey: day,
      customerId: customerRef ? customerRef.id : null,
      customerName: customer?.name || "Consumidor final",
      customerNit: customer?.nit || "",
      customerPhone: customer?.whatsapp || customer?.phone || "",
      userId: session.uid,
      userName: session.name,
      items: computed.items.map((item) => ({
        manual: item.manual,
        productId: item.productId,
        code: item.code,
        name: item.name,
        qty: item.qty,
        unitId: item.unitId,
        unitName: item.unitName,
        factor: item.factor,
        baseQty: item.baseQty,
        unitPrice: item.unitPrice,
        cost: item.cost,
        discount: item.discount,
        lineTotal: item.lineTotal,
        returnedQty: 0
      })),
      subtotal: computed.subtotal,
      discount: computed.discount,
      total: computed.total,
      costTotal: computed.costTotal,
      payments: computed.payments,
      paid: computed.paid,
      balance: computed.balance,
      returnedAmount: 0,
      returnedCost: 0,
      refunded: 0,
      paymentStatus: computed.paymentStatus,
      status: "completed",
      notes: input.notes?.trim() || "",
      dueDate: toCents(computed.balance) > 0 ? input.dueDate : null,
      quoteId: input.quoteId || null,
      quoteNumber: quoteSnap?.data()?.number || null,
      requestId: input.requestId,
      cashTendered,
      change,
      receipts: [],
      returns: [],
      createdAt: now
    };
    transaction.set(counterRef, { sale: (counterSnap.data()?.sale || 0) + 1 }, { merge: true });
    transaction.set(saleRef, clean(sale));
    for (const [productId, baseQty] of needed) {
      const snap = products.get(productId);
      const product = snap.data();
      const previous = roundQty(product.stock || 0);
      const next = roundQty(previous - baseQty);
      const flags = stockFlags(next, product.minStock || 0);
      transaction.update(snap.ref, {
        stock: next,
        lowStock: flags.lowStock,
        outOfStock: flags.outOfStock,
        updatedAt: now
      });
      transaction.set(doc(collection(db, "inventoryMovements")), movementPayload({
        productId,
        productName: product.name,
        productCode: product.code,
        type: "sale",
        quantity: -baseQty,
        previousStock: previous,
        newStock: next,
        unitName: product.unitName,
        reason: "Venta",
        referenceType: "sale",
        referenceId: saleRef.id,
        referenceNumber: number,
        dateKey: day
      }));
    }
    computed.payments.forEach((payment) => {
      transaction.set(doc(collection(db, "payments")), clean({
        type: payment.methodCode === "credit" ? "credit" : "sale",
        saleId: saleRef.id,
        saleNumber: number,
        customerId: sale.customerId,
        customerName: sale.customerName,
        receivableId: payment.methodCode === "credit" ? saleRef.id : null,
        amount: payment.amount,
        methodId: payment.methodId,
        methodName: payment.methodName,
        methodCode: payment.methodCode,
        reference: payment.reference,
        date: now,
        at: Date.now(),
        dateKey: day,
        userId: session.uid,
        userName: session.name,
        notes: "",
        voided: false
      }));
    });
    if (toCents(computed.balance) > 0) {
      transaction.set(doc(db, "receivables", saleRef.id), {
        saleId: saleRef.id,
        saleNumber: number,
        customerId: customerRef.id,
        customerName: sale.customerName,
        originalAmount: computed.balance,
        paidAmount: 0,
        returnedCredit: 0,
        balance: computed.balance,
        dueDate: input.dueDate,
        status: "open",
        createdAt: now,
        updatedAt: now,
        lastPaymentAt: null
      });
      transaction.update(customerRef, {
        balance: roundMoney((customer.balance || 0) + computed.balance),
        updatedAt: now
      });
    }
    if (quoteRef) {
      transaction.update(quoteRef, {
        status: "converted",
        convertedSaleId: saleRef.id,
        convertedSaleNumber: number,
        updatedAt: now
      });
    }
    transaction.set(idemRef, { saleId: saleRef.id, uid: session.uid, type: "sale", createdAt: now });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload("sale.create", "ventas", saleRef.id, number));
    return { duplicate: false, sale: { id: saleRef.id, ...sale } };
  });
  if (result.duplicate) {
    const snap = await getDoc(doc(db, "sales", result.saleId));
    return { duplicate: true, sale: { id: snap.id, ...snap.data() } };
  }
  return result;
}

export async function updateDueDate(receivableId, dueDate) {
  requireUser();
  assertCan("receivables.dueDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate || ""))) throw new Error("Indique una fecha válida.");
  await updateDoc(doc(db, "receivables", receivableId), { dueDate, updatedAt: Timestamp.now() });
}

export async function registerAbono(input) {
  const session = requireUser();
  if (!can("receivables.abono") && !can("receivables.payFull")) assertCan("receivables.abono");
  if (!input.requestId) throw new Error("No se pudo identificar el abono.");
  const paymentRef = doc(collection(db, "payments"));
  const result = await runTransaction(db, async (transaction) => {
    const idemRef = doc(db, "idempotency", input.requestId);
    const idemSnap = await transaction.get(idemRef);
    if (idemSnap.exists()) return { duplicate: true, paymentId: idemSnap.data().paymentId };
    const receivableRef = doc(db, "receivables", input.receivableId);
    const receivableSnap = await transaction.get(receivableRef);
    if (!receivableSnap.exists()) throw new Error("La cuenta por cobrar no existe.");
    const receivable = receivableSnap.data();
    if (receivable.status === "void") throw new Error("La cuenta anulada no admite abonos.");
    const methodSnap = await transaction.get(doc(db, "paymentMethods", input.methodId));
    if (!methodSnap.exists() || methodSnap.data().active === false || methodSnap.data().code === "credit") {
      throw new Error("Seleccione un método de pago distinto de crédito.");
    }
    const method = methodSnap.data();
    if (method.requiresReference && !String(input.reference || "").trim()) {
      throw new Error(`Indique la referencia de ${method.name}.`);
    }
    const customerRef = doc(db, "customers", receivable.customerId);
    const customerSnap = await transaction.get(customerRef);
    const saleRef = doc(db, "sales", receivable.saleId);
    const saleSnap = await transaction.get(saleRef);
    const counterRef = doc(db, "counters", "main");
    const counterSnap = await transaction.get(counterRef);
    const applied = applyAbono(receivable.balance, input.amount);
    if (!can("receivables.abono") && roundMoney(receivable.balance - applied.amount) > 0.009) {
      throw new Error("Solo puede registrar el pago completo de la cuenta.");
    }
    const saleApplied = applyAbono(saleSnap.data().balance, input.amount);
    const nextCustomer = roundMoney((customerSnap.data()?.balance || 0) - applied.amount);
    if (nextCustomer < -0.001) throw new Error("El saldo del cliente no coincide con esta cuenta. Revise antes de continuar.");
    const now = Timestamp.now();
    const number = padNumber("REC", (counterSnap.data()?.payment || 0) + 1);
    const sale = saleSnap.data();
    const paid = roundMoney((sale.paid || 0) + applied.amount);
    const payment = {
      number,
      type: "abono",
      saleId: saleRef.id,
      saleNumber: receivable.saleNumber,
      customerId: receivable.customerId,
      customerName: receivable.customerName,
      receivableId: receivableRef.id,
      amount: applied.amount,
      methodId: methodSnap.id,
      methodName: method.name,
      methodCode: method.code,
      reference: String(input.reference || "").trim(),
      notes: input.notes?.trim() || "",
      date: now,
      at: Date.now(),
      dateKey: dateKey(),
      userId: session.uid,
      userName: session.name,
      voided: false
    };
    transaction.set(counterRef, { payment: (counterSnap.data()?.payment || 0) + 1 }, { merge: true });
    transaction.set(paymentRef, clean(payment));
    transaction.update(receivableRef, {
      paidAmount: roundMoney((receivable.paidAmount || 0) + applied.amount),
      balance: applied.balance,
      status: applied.status,
      lastPaymentAt: now,
      updatedAt: now
    });
    transaction.update(customerRef, { balance: nextCustomer, updatedAt: now });
    transaction.update(saleRef, {
      paid,
      balance: saleApplied.balance,
      paymentStatus: paymentStatus(paid, saleApplied.balance),
      receipts: [...(sale.receipts || []), {
        number,
        amount: applied.amount,
        methodName: method.name,
        dateKey: dateKey(),
        at: Date.now()
      }],
      updatedAt: now
    });
    transaction.set(idemRef, { paymentId: paymentRef.id, uid: session.uid, type: "abono", createdAt: now });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload("payment.abono", "cuentas", paymentRef.id, number));
    return { duplicate: false, payment: { id: paymentRef.id, ...payment }, balance: applied.balance, customerName: receivable.customerName };
  });
  if (result.duplicate) {
    const snap = await getDoc(doc(db, "payments", result.paymentId));
    return { duplicate: true, payment: { id: snap.id, ...snap.data() }, balance: null };
  }
  return result;
}

export async function registerReturn(input) {
  const session = requireUser();
  assertCan("sales.returns");
  if (!input.reason || input.reason.trim().length < 3) throw new Error("Escriba el motivo de la devolución.");
  await runTransaction(db, async (transaction) => {
    const idemRef = doc(db, "idempotency", input.requestId);
    const idemSnap = await transaction.get(idemRef);
    if (idemSnap.exists()) return;
    const settingsSnap = await transaction.get(doc(db, "settings", "general"));
    const saleRef = doc(db, "sales", input.saleId);
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) throw new Error("La venta no existe.");
    const sale = saleSnap.data();
    const plan = computeReturn(sale, input.lines);
    const productIds = [...new Set(plan.items.filter((item) => item.productId).map((item) => item.productId))];
    const products = new Map();
    for (const productId of productIds) {
      products.set(productId, await transaction.get(doc(db, "products", productId)));
    }
    let receivableSnap = null;
    const receivableRef = doc(db, "receivables", saleRef.id);
    if (toCents(plan.creditReduction) > 0) receivableSnap = await transaction.get(receivableRef);
    let customerSnap = null;
    let customerRef = null;
    if (sale.customerId && toCents(plan.creditReduction) > 0) {
      customerRef = doc(db, "customers", sale.customerId);
      customerSnap = await transaction.get(customerRef);
    }
    const counterRef = doc(db, "counters", "main");
    const counterSnap = await transaction.get(counterRef);
    const now = Timestamp.now();
    const number = padNumber("DEV", (counterSnap.data()?.return || 0) + 1);
    const returnedLines = input.lines.map((line) => ({
      index: line.index,
      qty: roundQty(line.qty),
      name: sale.items[line.index].name
    }));
    transaction.set(counterRef, { return: (counterSnap.data()?.return || 0) + 1 }, { merge: true });
    const restock = new Map();
    input.lines.forEach((line) => {
      const item = sale.items[line.index];
      if (!item?.productId) return;
      const baseQty = roundQty(roundQty(line.qty) * (item.factor || 1));
      restock.set(item.productId, roundQty((restock.get(item.productId) || 0) + baseQty));
    });
    restock.forEach((baseQty, productId) => {
      const snap = products.get(productId);
      if (!snap?.exists()) return;
      const product = snap.data();
      const previous = roundQty(product.stock || 0);
      const next = roundQty(previous + baseQty);
      const flags = stockFlags(next, product.minStock || 0);
      transaction.update(snap.ref, {
        stock: next,
        lowStock: product.active === false ? false : flags.lowStock,
        outOfStock: product.active === false ? false : flags.outOfStock,
        updatedAt: now
      });
      transaction.set(doc(collection(db, "inventoryMovements")), movementPayload({
        productId,
        productName: product.name,
        productCode: product.code,
        type: "return",
        quantity: baseQty,
        previousStock: previous,
        newStock: next,
        unitName: product.unitName,
        reason: `Devolución ${number}: ${input.reason.trim()}`,
        referenceType: "return",
        referenceId: saleRef.id,
        referenceNumber: sale.number
      }));
    });
    if (toCents(plan.creditReduction) > 0 && receivableSnap?.exists()) {
      const receivable = receivableSnap.data();
      const nextBalance = roundMoney(receivable.balance - plan.creditReduction);
      transaction.update(receivableRef, {
        balance: nextBalance,
        returnedCredit: roundMoney((receivable.returnedCredit || 0) + plan.creditReduction),
        status: toCents(nextBalance) === 0 ? "paid" : receivable.status === "open" && toCents(receivable.paidAmount) === 0 ? "open" : "partial",
        updatedAt: now
      });
      if (customerRef) {
        transaction.update(customerRef, {
          balance: roundMoney(Math.max(0, (customerSnap.data().balance || 0) - plan.creditReduction)),
          updatedAt: now
        });
      }
    }
    if (toCents(plan.refundAmount) > 0) {
      transaction.set(doc(collection(db, "payments")), clean({
        number,
        type: "refund",
        saleId: saleRef.id,
        saleNumber: sale.number,
        customerId: sale.customerId,
        customerName: sale.customerName,
        amount: plan.refundAmount,
        methodId: "efectivo",
        methodName: "Efectivo",
        methodCode: "cash",
        reference: "",
        notes: input.reason.trim(),
        date: now,
        at: Date.now(),
        dateKey: dateKey(),
        userId: session.uid,
        userName: session.name,
        voided: false
      }));
    }
    transaction.update(saleRef, clean({
      items: plan.items,
      status: plan.status,
      balance: plan.nextBalance,
      returnedAmount: plan.nextReturnedAmount,
      returnedCost: plan.nextReturnedCost,
      refunded: plan.nextRefunded,
      paymentStatus: paymentStatus(sale.paid || 0, plan.nextBalance),
      returns: [...(sale.returns || []), {
        number,
        reason: input.reason.trim(),
        amount: plan.returnAmount,
        refundAmount: plan.refundAmount,
        creditAmount: plan.creditReduction,
        lines: returnedLines,
        userId: session.uid,
        userName: session.name,
        dateKey: dateKey(),
        at: Date.now()
      }],
      updatedAt: now
    }));
    transaction.set(idemRef, { returnNumber: number, uid: session.uid, type: "return", createdAt: now });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload("sale.return", "ventas", saleRef.id, number));
  });
}

export async function voidSale(input) {
  const session = requireUser();
  assertCan("sales.void");
  if (!input.reason || input.reason.trim().length < 3) throw new Error("Escriba el motivo de la anulación.");
  await runTransaction(db, async (transaction) => {
    const idemRef = doc(db, "idempotency", input.requestId);
    const idemSnap = await transaction.get(idemRef);
    if (idemSnap.exists()) return;
    const saleRef = doc(db, "sales", input.saleId);
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) throw new Error("La venta no existe.");
    const sale = saleSnap.data();
    const plan = computeVoid(sale);
    const productIds = [...new Set(sale.items.filter((item) => item.productId).map((item) => item.productId))];
    const products = new Map();
    for (const productId of productIds) {
      products.set(productId, await transaction.get(doc(db, "products", productId)));
    }
    const receivableRef = doc(db, "receivables", saleRef.id);
    const receivableSnap = await transaction.get(receivableRef);
    let customerSnap = null;
    let customerRef = null;
    if (sale.customerId && receivableSnap.exists() && toCents(receivableSnap.data().balance) > 0) {
      customerRef = doc(db, "customers", sale.customerId);
      customerSnap = await transaction.get(customerRef);
    }
    const now = Timestamp.now();
    const restock = new Map();
    sale.items.forEach((item) => {
      if (!item.productId) return;
      const remaining = roundQty(item.qty - (item.returnedQty || 0));
      if (remaining <= 0) return;
      const baseQty = roundQty(remaining * (item.factor || 1));
      restock.set(item.productId, roundQty((restock.get(item.productId) || 0) + baseQty));
    });
    restock.forEach((baseQty, productId) => {
      const snap = products.get(productId);
      if (!snap?.exists()) return;
      const product = snap.data();
      const previous = roundQty(product.stock || 0);
      const next = roundQty(previous + baseQty);
      const flags = stockFlags(next, product.minStock || 0);
      transaction.update(snap.ref, {
        stock: next,
        lowStock: product.active === false ? false : flags.lowStock,
        outOfStock: product.active === false ? false : flags.outOfStock,
        updatedAt: now
      });
      transaction.set(doc(collection(db, "inventoryMovements")), movementPayload({
        productId,
        productName: product.name,
        productCode: product.code,
        type: "return",
        quantity: baseQty,
        previousStock: previous,
        newStock: next,
        unitName: product.unitName,
        reason: `Anulación ${sale.number}: ${input.reason.trim()}`,
        referenceType: "void",
        referenceId: saleRef.id,
        referenceNumber: sale.number
      }));
    });
    if (receivableSnap.exists()) {
      const openBalance = roundMoney(receivableSnap.data().balance || 0);
      transaction.update(receivableRef, {
        balance: 0,
        status: "void",
        updatedAt: now
      });
      if (customerRef && toCents(openBalance) > 0) {
        transaction.update(customerRef, {
          balance: roundMoney(Math.max(0, (customerSnap.data().balance || 0) - openBalance)),
          updatedAt: now
        });
      }
    }
    if (toCents(plan.refundNow) > 0) {
      transaction.set(doc(collection(db, "payments")), clean({
        type: "refund",
        saleId: saleRef.id,
        saleNumber: sale.number,
        customerId: sale.customerId,
        customerName: sale.customerName,
        amount: plan.refundNow,
        methodId: "efectivo",
        methodName: "Efectivo",
        methodCode: "cash",
        reference: "",
        notes: `Anulación: ${input.reason.trim()}`,
        date: now,
        at: Date.now(),
        dateKey: dateKey(),
        userId: session.uid,
        userName: session.name,
        voided: false
      }));
    }
    transaction.update(saleRef, {
      status: "void",
      balance: 0,
      paymentStatus: "void",
      refunded: roundMoney((sale.refunded || 0) + plan.refundNow),
      voidReason: input.reason.trim(),
      voidedAt: now,
      voidedBy: session.uid,
      voidedByName: session.name,
      updatedAt: now
    });
    transaction.set(idemRef, { saleId: saleRef.id, uid: session.uid, type: "void", createdAt: now });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload("sale.void", "ventas", saleRef.id, sale.number));
  });
}

export async function saveCustomer(input) {
  const session = requireUser();
  assertCan(input.id ? "customers.edit" : "customers.create");
  if (!String(input.name || "").trim()) throw new Error("El nombre del cliente es obligatorio.");
  const refId = input.id ? doc(db, "customers", input.id) : doc(collection(db, "customers"));
  const data = {
    name: input.name.trim(),
    nameLower: normalize(input.name),
    nit: input.nit?.trim() || "",
    phone: input.phone?.trim() || "",
    whatsapp: input.whatsapp?.trim() || "",
    address: input.address?.trim() || "",
    email: input.email?.trim() || "",
    notes: input.notes?.trim() || "",
    active: input.active !== false,
    updatedAt: Timestamp.now()
  };
  if (!input.id) {
    data.balance = 0;
    data.createdAt = Timestamp.now();
    data.createdBy = session.uid;
  }
  await setDoc(refId, clean(data), { merge: true });
  await setDoc(doc(collection(db, "auditLogs")), auditPayload(input.id ? "customer.update" : "customer.create", "clientes", refId.id, data.name));
  return refId.id;
}

export async function setCustomerActive(customerId, active) {
  requireUser();
  assertCan("customers.disable");
  const snap = await getDoc(doc(db, "customers", customerId));
  if (!snap.exists()) throw new Error("El cliente no existe.");
  await updateDoc(doc(db, "customers", customerId), { active, updatedAt: Timestamp.now() });
  await setDoc(doc(collection(db, "auditLogs")), auditPayload(active ? "customer.activate" : "customer.deactivate", "clientes", customerId, snap.data().name));
}

export async function saveSupplier(input) {
  const session = requireUser();
  assertCan(input.id ? "suppliers.edit" : "suppliers.create");
  if (!String(input.name || "").trim()) throw new Error("El nombre del proveedor es obligatorio.");
  const refId = input.id ? doc(db, "suppliers", input.id) : doc(collection(db, "suppliers"));
  const data = {
    name: input.name.trim(),
    nameLower: normalize(input.name),
    company: input.company?.trim() || "",
    nit: input.nit?.trim() || "",
    phone: input.phone?.trim() || "",
    whatsapp: input.whatsapp?.trim() || "",
    email: input.email?.trim() || "",
    address: input.address?.trim() || "",
    contactName: input.contactName?.trim() || "",
    notes: input.notes?.trim() || "",
    active: input.active !== false,
    updatedAt: Timestamp.now()
  };
  if (!input.id) {
    data.createdAt = Timestamp.now();
    data.createdBy = session.uid;
  }
  await setDoc(refId, clean(data), { merge: true });
  await setDoc(doc(collection(db, "auditLogs")), auditPayload(input.id ? "supplier.update" : "supplier.create", "proveedores", refId.id, data.name));
  return refId.id;
}

export async function setSupplierActive(supplierId, active) {
  requireUser();
  assertCan("suppliers.disable");
  const snap = await getDoc(doc(db, "suppliers", supplierId));
  if (!snap.exists()) throw new Error("El proveedor no existe.");
  await updateDoc(doc(db, "suppliers", supplierId), { active, updatedAt: Timestamp.now() });
}

export async function saveQuote(input) {
  const session = requireUser();
  assertCan(input.id ? "quotes.edit" : "quotes.create");
  const computed = computeQuote({ items: input.items, globalDiscount: input.discount || 0 });
  const quoteRef = input.id ? doc(db, "quotes", input.id) : doc(collection(db, "quotes"));
  await runTransaction(db, async (transaction) => {
    const counterRef = doc(db, "counters", "main");
    let number = input.number;
    let counterSnap = null;
    if (!input.id) {
      counterSnap = await transaction.get(counterRef);
      number = padNumber("COT", (counterSnap.data()?.quote || 0) + 1);
    } else {
      const current = await transaction.get(quoteRef);
      if (!current.exists()) throw new Error("La cotización no existe.");
      if (current.data().status === "converted") throw new Error("La cotización convertida ya no se puede editar.");
      number = current.data().number;
    }
    let customerName = input.customerName || "Cliente mostrador";
    if (input.customerId) {
      const customerSnap = await transaction.get(doc(db, "customers", input.customerId));
      if (!customerSnap.exists()) throw new Error("El cliente no existe.");
      customerName = customerSnap.data().name;
    }
    if (!input.id) transaction.set(counterRef, { quote: (counterSnap.data()?.quote || 0) + 1 }, { merge: true });
    const now = Timestamp.now();
    transaction.set(quoteRef, clean({
      number,
      status: input.status || "pending",
      customerId: input.customerId || null,
      customerName,
      customerPhone: input.customerPhone || "",
      items: computed.items.map((item) => ({
        manual: !item.productId,
        productId: item.productId || null,
        code: item.code || (item.productId ? "" : "MANUAL"),
        name: item.name,
        qty: item.qty,
        unitId: item.unitId || "",
        unitName: item.unitName || "Unidad",
        factor: item.factor || 1,
        unitPrice: item.unitPrice,
        discount: item.discount,
        lineTotal: item.lineTotal
      })),
      subtotal: computed.subtotal,
      discount: computed.discount,
      total: computed.total,
      validUntil: input.validUntil || null,
      notes: input.notes?.trim() || "",
      userId: session.uid,
      userName: session.name,
      updatedAt: now,
      ...(input.id ? {} : { createdAt: now, date: now, at: Date.now(), dateKey: dateKey(), convertedSaleId: null })
    }), { merge: true });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload(input.id ? "quote.update" : "quote.create", "cotizaciones", quoteRef.id, number));
  });
  return quoteRef.id;
}

export async function updateQuoteStatus(quoteId, status) {
  requireUser();
  if (status === "approved") assertCan("quotes.approve");
  else if (status === "rejected") assertCan("quotes.discard");
  else if (status === "sent") assertCan("quotes.whatsapp");
  else assertCan("quotes.edit");
  const allowed = ["draft", "pending", "sent", "approved", "rejected", "expired"];
  if (!allowed.includes(status)) throw new Error("El estado no es válido.");
  const refId = doc(db, "quotes", quoteId);
  const snap = await getDoc(refId);
  if (!snap.exists()) throw new Error("La cotización no existe.");
  if (snap.data().status === "converted") throw new Error("La cotización ya fue convertida.");
  await updateDoc(refId, { status, updatedAt: Timestamp.now() });
}

export async function saveExpense(input) {
  const session = requireUser();
  assertCan(input.id ? "expenses.edit" : "expenses.create");
  if (!String(input.description || "").trim()) throw new Error("La descripción es obligatoria.");
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("El monto debe ser mayor que cero.");
  const refId = input.id ? doc(db, "expenses", input.id) : doc(collection(db, "expenses"));
  await runTransaction(db, async (transaction) => {
    let number = input.number;
    const counterRef = doc(db, "counters", "main");
    let counterSnap = null;
    if (!input.id) {
      counterSnap = await transaction.get(counterRef);
      number = padNumber("GAS", (counterSnap.data()?.expense || 0) + 1);
      transaction.set(counterRef, { expense: (counterSnap.data()?.expense || 0) + 1 }, { merge: true });
    } else {
      const current = await transaction.get(refId);
      if (!current.exists()) throw new Error("El gasto no existe.");
      if (current.data().status === "void") throw new Error("Un gasto anulado no se puede editar.");
      number = current.data().number;
    }
    const now = Timestamp.now();
    const day = input.dateKey || dateKey();
    transaction.set(refId, clean({
      number,
      description: input.description.trim(),
      categoryId: input.categoryId || "",
      categoryName: input.categoryName || "Otros",
      amount,
      date: Timestamp.fromDate(keyToDate(day)),
      dateKey: day,
      at: Date.now(),
      paymentMethodId: input.paymentMethodId || "",
      paymentMethodName: input.paymentMethodName || "",
      notes: input.notes?.trim() || "",
      userId: session.uid,
      userName: session.name,
      status: "active",
      updatedAt: now,
      ...(input.id ? {} : { createdAt: now })
    }), { merge: true });
    transaction.set(doc(collection(db, "auditLogs")), auditPayload(input.id ? "expense.update" : "expense.create", "gastos", refId.id, number));
  });
  return refId.id;
}

export async function voidExpense(expenseId, reason) {
  const session = requireUser();
  assertCan("expenses.void");
  if (!reason || reason.trim().length < 3) throw new Error("Escriba el motivo de la anulación.");
  await updateDoc(doc(db, "expenses", expenseId), {
    status: "void",
    voidReason: reason.trim(),
    voidedAt: Timestamp.now(),
    voidedBy: session.uid,
    updatedAt: Timestamp.now()
  });
  await setDoc(doc(collection(db, "auditLogs")), auditPayload("expense.void", "gastos", expenseId, reason.trim()));
}

export async function globalSearch(term) {
  const session = requireUser();
  const value = term.trim();
  const needle = normalize(value);
  if (needle.length < 2) return [];
  const jobs = [];
  if (can("inventory.view") || can("pos.access")) {
    jobs.push(getDocs(query(collection(db, "products"), where("nameLower", ">=", needle), where("nameLower", "<=", `${needle}\uf8ff`), orderBy("nameLower"), limit(6))));
    jobs.push(getDocs(query(collection(db, "products"), where("codeLower", "==", needle), limit(4))));
  }
  if (can("customers.view")) {
    jobs.push(getDocs(query(collection(db, "customers"), where("nameLower", ">=", needle), where("nameLower", "<=", `${needle}\uf8ff`), orderBy("nameLower"), limit(5))));
  }
  if (can("sales.view") && /^v-\d+$/i.test(value)) jobs.push(getDocs(query(collection(db, "sales"), where("number", "==", value.toUpperCase()), limit(1))));
  if (can("quotes.view") && /^cot-\d+$/i.test(value)) jobs.push(getDocs(query(collection(db, "quotes"), where("number", "==", value.toUpperCase()), limit(1))));
  const snaps = await Promise.all(jobs);
  const results = [];
  const push = (type, id, title, subtitle, href) => {
    if (results.some((item) => item.type === type && item.id === id)) return;
    results.push({ type, id, title, subtitle, href });
  };
  snaps.forEach((snap) => snap.docs.forEach((item) => {
    const data = item.data();
    if (data.code && data.name && !data.number) push("product", item.id, data.name, data.code, "#/inventario");
    else if (!data.number && data.name) push("customer", item.id, data.name, data.phone || data.nit || "Cliente", `#/clientes?id=${item.id}`);
    else if (data.number?.startsWith("V-")) push("sale", item.id, data.number, data.customerName, `#/ventas?id=${item.id}`);
    else if (data.number?.startsWith("COT-")) push("quote", item.id, data.number, data.customerName, `#/cotizaciones?id=${item.id}`);
  }));
  return results.slice(0, 12);
}

export async function exportBackup() {
  const session = requireUser();
  assertCan("settings.business");
  const names = ["products", "categories", "units", "customers", "suppliers", "sales", "quotes", "payments", "receivables", "inventoryMovements", "stockEntries", "expenses", "paymentMethods", "expenseCategories", "auditLogs", "users"];
  const backup = { exportedAt: new Date().toISOString(), projectId: "ferretov-74fae", collections: {} };
  for (const name of names) {
    const snap = await getDocs(collection(db, name));
    backup.collections[name] = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
  const settings = await getDoc(doc(db, "settings", "general"));
  backup.collections.settings = settings.exists() ? [{ id: "general", ...settings.data() }] : [];
  return backup;
}
