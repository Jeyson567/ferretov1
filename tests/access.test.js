import test from "node:test";
import assert from "node:assert/strict";
import { allPermissions, blankPermissions, normalizePermissions, permissionsWithin, templateById } from "../js/access.js";
import { contrast, shade } from "../js/theme.js";

test("un propietario puede otorgar cualquier permiso", () => {
  assert.equal(permissionsWithin("owner", blankPermissions(), allPermissions()), true);
});

test("un administrador no puede otorgar un permiso que no tiene", () => {
  const actor = blankPermissions();
  actor.pos.access = true;
  actor.pos.create = true;
  const next = blankPermissions();
  next.pos.access = true;
  next.settings.users = true;
  assert.equal(permissionsWithin("admin", actor, next), false);
  next.settings.users = false;
  assert.equal(permissionsWithin("admin", actor, next), true);
});

test("la plantilla de cajero no incluye crédito, descuentos ni configuración", () => {
  const cashier = templateById("cajero");
  assert.equal(cashier.role, "employee");
  assert.equal(cashier.permissions.pos.access, true);
  assert.equal(cashier.permissions.pos.credit, false);
  assert.equal(cashier.permissions.pos.discount, false);
  assert.equal(cashier.permissions.settings.users, false);
  assert.equal(cashier.permissions.reports.profit, false);
});

test("normalizar descarta permisos desconocidos", () => {
  const permissions = normalizePermissions({ pos: { access: true, hack: true }, unknown: { view: true } });
  assert.equal(permissions.pos.access, true);
  assert.equal(permissions.pos.hack, undefined);
  assert.equal(permissions.unknown, undefined);
  assert.equal(permissions.inventory.delete, false);
});

test("el contraste y el tono del color principal se calculan", () => {
  assert.equal(contrast("#d4a017"), "#1b1404");
  assert.equal(contrast("#1d4f91"), "#ffffff");
  assert.notEqual(shade("#d4a017", -0.16), "#d4a017");
});
