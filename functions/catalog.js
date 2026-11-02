const MODULES = {
  dashboard: ["view", "viewStats", "viewSales", "viewProfits", "viewRecent"],
  inventory: ["view", "create", "edit", "delete", "increaseStock", "decreaseStock", "movements", "viewCosts", "viewPrices"],
  pos: ["access", "create", "discount", "changePrice", "customers", "payments", "credit", "cancel"],
  sales: ["view", "detail", "print", "returns", "void"],
  customers: ["view", "create", "edit", "disable", "history", "balances"],
  receivables: ["view", "abono", "payFull", "dueDate", "statement", "print", "whatsapp"],
  quotes: ["view", "create", "edit", "discard", "approve", "convert", "print", "whatsapp"],
  suppliers: ["view", "create", "edit", "disable", "entries", "history"],
  expenses: ["view", "create", "edit", "void", "report"],
  reports: ["view", "sales", "profit", "inventory", "receivables", "export", "print"],
  settings: ["view", "business", "colors", "methods", "categories", "units", "users", "permissions", "audit"]
};

function blankPermissions() {
  const permissions = {};
  Object.entries(MODULES).forEach(([module, actions]) => {
    permissions[module] = {};
    actions.forEach((action) => { permissions[module][action] = false; });
  });
  return permissions;
}

function normalizePermissions(input) {
  const permissions = blankPermissions();
  Object.entries(MODULES).forEach(([module, actions]) => {
    actions.forEach((action) => {
      permissions[module][action] = input?.[module]?.[action] === true;
    });
  });
  return permissions;
}

function permissionsWithin(actorRole, actorPermissions, nextPermissions) {
  if (actorRole === "owner" || (actorRole === "admin" && !actorPermissions)) return true;
  const granted = normalizePermissions(nextPermissions);
  const owned = normalizePermissions(actorPermissions);
  return Object.entries(MODULES).every(([module, actions]) => actions.every((action) => {
    return !granted[module][action] || owned[module][action] === true;
  }));
}

function hasPermission(user, module, action) {
  if (!user || user.active === false) return false;
  if (user.role === "owner") return true;
  if (user.role === "admin" && !user.permissions) return true;
  return user.permissions?.[module]?.[action] === true;
}

module.exports = { normalizePermissions, permissionsWithin, hasPermission };
