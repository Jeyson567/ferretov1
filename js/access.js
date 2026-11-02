export const PERMISSION_MODULES = [
  { id: "dashboard", label: "Dashboard", actions: [
    ["view", "Ver dashboard"],
    ["viewStats", "Ver estadísticas"],
    ["viewSales", "Ver ventas del día"],
    ["viewProfits", "Ver ganancias"],
    ["viewRecent", "Ver movimientos recientes"]
  ]},
  { id: "inventory", label: "Inventario", actions: [
    ["view", "Ver inventario"],
    ["create", "Crear productos"],
    ["edit", "Editar productos"],
    ["delete", "Eliminar o desactivar productos"],
    ["increaseStock", "Aumentar existencias"],
    ["decreaseStock", "Disminuir existencias"],
    ["movements", "Consultar movimientos"],
    ["viewCosts", "Ver costos de compra"],
    ["viewPrices", "Ver precios de venta"]
  ]},
  { id: "pos", label: "Punto de venta", actions: [
    ["access", "Acceder al POS"],
    ["create", "Crear ventas"],
    ["discount", "Aplicar descuentos"],
    ["changePrice", "Modificar precios"],
    ["customers", "Seleccionar clientes"],
    ["payments", "Registrar pagos"],
    ["credit", "Registrar ventas al crédito"],
    ["cancel", "Cancelar la venta en curso"]
  ]},
  { id: "sales", label: "Historial de ventas", actions: [
    ["view", "Ver historial"],
    ["detail", "Ver detalles"],
    ["print", "Reimprimir comprobantes"],
    ["returns", "Registrar devoluciones"],
    ["void", "Anular ventas"]
  ]},
  { id: "customers", label: "Clientes", actions: [
    ["view", "Ver clientes"],
    ["create", "Crear clientes"],
    ["edit", "Editar clientes"],
    ["disable", "Desactivar clientes"],
    ["history", "Consultar historial"],
    ["balances", "Consultar saldos"]
  ]},
  { id: "receivables", label: "Cuentas por cobrar", actions: [
    ["view", "Ver cuentas pendientes"],
    ["abono", "Registrar abonos"],
    ["payFull", "Registrar pagos completos"],
    ["dueDate", "Modificar fechas de vencimiento"],
    ["statement", "Consultar estados de cuenta"],
    ["print", "Imprimir recibos"],
    ["whatsapp", "Enviar recordatorios por WhatsApp"]
  ]},
  { id: "quotes", label: "Cotizaciones", actions: [
    ["view", "Ver cotizaciones"],
    ["create", "Crear cotizaciones"],
    ["edit", "Editar cotizaciones"],
    ["discard", "Descartar borradores"],
    ["approve", "Aprobar cotizaciones"],
    ["convert", "Convertir cotizaciones en ventas"],
    ["print", "Imprimir"],
    ["whatsapp", "Compartir por WhatsApp"]
  ]},
  { id: "suppliers", label: "Proveedores", actions: [
    ["view", "Ver proveedores"],
    ["create", "Crear proveedores"],
    ["edit", "Editar proveedores"],
    ["disable", "Desactivar proveedores"],
    ["entries", "Registrar entradas de inventario"],
    ["history", "Consultar historial"]
  ]},
  { id: "expenses", label: "Gastos", actions: [
    ["view", "Ver gastos"],
    ["create", "Registrar gastos"],
    ["edit", "Editar gastos"],
    ["void", "Anular gastos con autorización"],
    ["report", "Consultar reportes de gastos"]
  ]},
  { id: "reports", label: "Reportes", actions: [
    ["view", "Ver reportes"],
    ["sales", "Ver ventas"],
    ["profit", "Ver ganancias"],
    ["inventory", "Ver inventario"],
    ["receivables", "Ver cuentas por cobrar"],
    ["export", "Exportar información"],
    ["print", "Imprimir reportes"]
  ]},
  { id: "settings", label: "Configuración", actions: [
    ["view", "Ver configuración"],
    ["business", "Modificar datos comerciales"],
    ["colors", "Cambiar colores"],
    ["methods", "Modificar métodos de pago"],
    ["categories", "Gestionar categorías"],
    ["units", "Gestionar unidades"],
    ["users", "Gestionar usuarios"],
    ["permissions", "Gestionar permisos"],
    ["audit", "Consultar auditoría"]
  ]}
];

const LEGACY = {
  dashboard: "dashboard.view",
  pos: "pos.access",
  sales: "sales.view",
  quotes: "quotes.view",
  customers: "customers.view",
  receivables: "receivables.view",
  "products.read": "inventory.view",
  products: "inventory.edit",
  movements: "inventory.movements",
  entries: "suppliers.entries",
  suppliers: "suppliers.view",
  expenses: "expenses.view",
  reports: "reports.view",
  settings: "settings.view",
  users: "settings.users",
  audit: "settings.audit",
  profile: "profile.view"
};

export function permissionKey(permission) {
  return LEGACY[permission] || permission;
}

export function blankPermissions() {
  const permissions = {};
  PERMISSION_MODULES.forEach((module) => {
    permissions[module.id] = {};
    module.actions.forEach(([id]) => { permissions[module.id][id] = false; });
  });
  return permissions;
}

export function allPermissions() {
  const permissions = blankPermissions();
  Object.values(permissions).forEach((actions) => {
    Object.keys(actions).forEach((id) => { actions[id] = true; });
  });
  return permissions;
}

export function normalizePermissions(input) {
  const permissions = blankPermissions();
  PERMISSION_MODULES.forEach((module) => {
    module.actions.forEach(([id]) => {
      permissions[module.id][id] = input?.[module.id]?.[id] === true;
    });
  });
  return permissions;
}

export function permissionsWithin(actorRole, actorPermissions, nextPermissions) {
  if (actorRole === "owner" || (actorRole === "admin" && !actorPermissions)) return true;
  const granted = normalizePermissions(nextPermissions);
  const owned = normalizePermissions(actorPermissions);
  return PERMISSION_MODULES.every((module) => module.actions.every(([id]) => {
    return !granted[module.id][id] || owned[module.id][id] === true;
  }));
}

function pick(modules) {
  const permissions = blankPermissions();
  modules.forEach(([module, actions]) => {
    actions.forEach((id) => { permissions[module][id] = true; });
  });
  return permissions;
}

export const PERMISSION_TEMPLATES = [
  { id: "vendedor", label: "Vendedor", role: "employee", permissions: pick([
    ["dashboard", ["view", "viewStats", "viewSales", "viewRecent"]],
    ["pos", ["access", "create", "discount", "changePrice", "customers", "payments", "credit", "cancel"]],
    ["sales", ["view", "detail", "print"]],
    ["customers", ["view", "create", "edit", "history", "balances"]],
    ["receivables", ["view", "abono", "payFull", "statement", "print", "whatsapp"]],
    ["quotes", ["view", "create", "edit", "convert", "print", "whatsapp"]],
    ["inventory", ["view", "viewPrices"]]
  ]) },
  { id: "cajero", label: "Cajero", role: "employee", permissions: pick([
    ["dashboard", ["view", "viewSales"]],
    ["pos", ["access", "create", "customers", "payments", "cancel"]],
    ["sales", ["view", "detail", "print"]],
    ["customers", ["view", "create"]],
    ["receivables", ["view", "abono", "payFull", "print"]],
    ["inventory", ["view", "viewPrices"]]
  ]) },
  { id: "inventario", label: "Encargado de inventario", role: "employee", permissions: pick([
    ["dashboard", ["view", "viewStats", "viewRecent"]],
    ["inventory", ["view", "create", "edit", "increaseStock", "decreaseStock", "movements", "viewCosts", "viewPrices"]],
    ["suppliers", ["view", "create", "edit", "entries", "history"]]
  ]) },
  { id: "admin", label: "Administrador personalizado", role: "admin", permissions: allPermissions() }
];

export function templateById(id) {
  return PERMISSION_TEMPLATES.find((item) => item.id === id) || null;
}
