import { getSession } from "./auth.js";
import { permissionKey } from "./access.js";

export { PERMISSION_MODULES, PERMISSION_TEMPLATES, allPermissions, blankPermissions, normalizePermissions, permissionsWithin, templateById } from "./access.js";

export const ROLE_LABELS = {
  owner: "Propietario",
  admin: "Administrador",
  employee: "Empleado",
  seller: "Vendedor",
  inventory: "Encargado de inventario"
};

const LEGACY_ROLES = {
  admin: ["*"],
  seller: [
    "dashboard.view", "dashboard.viewStats", "dashboard.viewSales", "dashboard.viewRecent",
    "pos.access", "pos.create", "pos.discount", "pos.changePrice", "pos.customers", "pos.payments", "pos.credit", "pos.cancel",
    "sales.view", "sales.detail", "sales.print",
    "quotes.view", "quotes.create", "quotes.edit", "quotes.convert", "quotes.print", "quotes.whatsapp",
    "customers.view", "customers.create", "customers.edit", "customers.history", "customers.balances",
    "receivables.view", "receivables.abono", "receivables.payFull", "receivables.statement", "receivables.print", "receivables.whatsapp",
    "inventory.view", "inventory.viewPrices"
  ],
  inventory: [
    "dashboard.view", "dashboard.viewStats", "dashboard.viewRecent",
    "inventory.view", "inventory.create", "inventory.edit", "inventory.increaseStock", "inventory.decreaseStock", "inventory.movements", "inventory.viewCosts", "inventory.viewPrices",
    "suppliers.view", "suppliers.create", "suppliers.edit", "suppliers.entries", "suppliers.history"
  ]
};

export function can(permission) {
  const session = getSession();
  if (!session || session.active === false) return false;
  const key = permissionKey(permission);
  if (key === "profile.view") return true;
  if (session.role === "owner") return true;
  if (!session.permissions && LEGACY_ROLES[session.role]) {
    const granted = LEGACY_ROLES[session.role];
    return granted.includes("*") || granted.includes(key);
  }
  const [module, action] = key.split(".");
  if (!module || !action) return false;
  return session.permissions?.[module]?.[action] === true;
}

export function canAny(list) {
  return list.some((permission) => can(permission));
}

export function assertCan(permission) {
  if (!can(permission)) throw new Error("No tiene permiso para esta operación.");
}
