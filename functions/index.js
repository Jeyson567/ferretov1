// Sin uso en el plan Spark. Los empleados se crean en js/staff.js con una sesión secundaria.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { hasPermission, normalizePermissions, permissionsWithin } = require("./catalog");

initializeApp();

exports.manageStaff = onCall({
  region: "us-central1",
  cors: true,
  invoker: "public"
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debe iniciar sesión.");
  const db = getFirestore();
  const auth = getAuth();
  const actorSnap = await db.doc(`users/${request.auth.uid}`).get();
  if (!actorSnap.exists) throw new HttpsError("permission-denied", "Su usuario no está registrado.");
  const actor = actorSnap.data();
  if (!hasPermission(actor, "settings", "users") || !hasPermission(actor, "settings", "permissions")) {
    throw new HttpsError("permission-denied", "No tiene permiso para administrar usuarios.");
  }
  const system = await db.doc("settings/system").get();
  const ownerUid = system.data()?.ownerUid || system.data()?.initializedBy || null;
  const action = request.data?.action;
  if (action === "create") return createUser({ db, auth, actor, ownerUid, data: request.data, actorUid: request.auth.uid });
  if (action === "update") return updateUser({ db, auth, actor, ownerUid, data: request.data, actorUid: request.auth.uid });
  throw new HttpsError("invalid-argument", "La operación no es válida.");
});

async function createUser({ db, auth, actor, data, actorUid }) {
  const email = cleanEmail(data.email);
  const name = cleanName(data.name);
  const password = String(data.password || "");
  const role = data.role === "admin" ? "admin" : "employee";
  if (role === "admin" && actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Solo el propietario puede crear administradores.");
  }
  if (password.length < 6) throw new HttpsError("invalid-argument", "La contraseña inicial debe tener al menos 6 caracteres.");
  const permissions = normalizePermissions(data.permissions);
  if (!permissionsWithin(actor.role, actor.permissions, permissions)) {
    throw new HttpsError("permission-denied", "No puede otorgar permisos que usted no tiene.");
  }
  let created = null;
  try {
    created = await auth.createUser({ email, password, displayName: name, disabled: false });
    const now = Timestamp.now();
    await db.doc(`users/${created.uid}`).set({
      email,
      name,
      role,
      active: true,
      status: "active",
      permissions,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      lastAccessAt: null
    });
    await db.collection("auditLogs").add({
      action: "user.create",
      module: "usuarios",
      targetId: created.uid,
      detail: `${name} · ${role}`,
      userId: actorUid,
      userName: actor.name || "",
      at: now
    });
    return { uid: created.uid };
  } catch (error) {
    if (created?.uid) await auth.deleteUser(created.uid).catch(() => {});
    throw mapAuthError(error);
  }
}

async function updateUser({ db, auth, actor, ownerUid, data, actorUid }) {
  const uid = String(data.uid || "");
  if (!uid) throw new HttpsError("invalid-argument", "Falta el usuario.");
  if (uid === ownerUid) throw new HttpsError("permission-denied", "El propietario principal no se puede modificar desde aquí.");
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "El usuario no existe.");
  const current = snap.data();
  if (current.role === "owner") throw new HttpsError("permission-denied", "El propietario principal no se puede modificar.");
  if (actor.role !== "owner" && current.role === "admin") {
    throw new HttpsError("permission-denied", "Un administrador no puede modificar a otro administrador.");
  }
  const role = data.role === "admin" ? "admin" : "employee";
  if (role === "admin" && actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Solo el propietario puede asignar el rol de administrador.");
  }
  const permissions = normalizePermissions(data.permissions);
  if (!permissionsWithin(actor.role, actor.permissions, permissions)) {
    throw new HttpsError("permission-denied", "No puede otorgar permisos que usted no tiene.");
  }
  if (uid === actorUid && data.active === false) {
    throw new HttpsError("permission-denied", "No puede desactivar su propia cuenta.");
  }
  const active = data.active !== false;
  const name = cleanName(data.name || current.name);
  const password = String(data.password || "");
  if (password && password.length < 6) {
    throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
  }
  const authPatch = { displayName: name, disabled: !active };
  if (password) authPatch.password = password;
  await auth.updateUser(uid, authPatch);
  const now = Timestamp.now();
  try {
    await ref.set({
      name,
      role,
      active,
      status: active ? "active" : "inactive",
      permissions,
      updatedAt: now
    }, { merge: true });
  } catch (error) {
    await auth.updateUser(uid, {
      displayName: current.name || name,
      disabled: current.active === false
    }).catch(() => {});
    throw error;
  }
  await db.collection("auditLogs").add({
    action: "user.update",
    module: "usuarios",
    targetId: uid,
    detail: `${name} · ${role} · ${active ? "activo" : "inactivo"}`,
    userId: actorUid,
    userName: actor.name || "",
    at: now
  });
  return { uid };
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 120) throw new HttpsError("invalid-argument", "Escriba un correo válido.");
  return email;
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (name.length < 2 || name.length > 80) throw new HttpsError("invalid-argument", "Escriba el nombre del usuario.");
  return name;
}

function mapAuthError(error) {
  if (error instanceof HttpsError) return error;
  if (error?.code === "auth/email-already-exists") return new HttpsError("already-exists", "Ese correo ya está registrado.");
  if (error?.code === "auth/invalid-password") return new HttpsError("invalid-argument", "La contraseña no cumple el mínimo de 6 caracteres.");
  return new HttpsError("internal", "No se pudo crear la cuenta. Intente de nuevo.");
}
