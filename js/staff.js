import app, { auth, db } from "./firebase-config.js";
import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { createUserWithEmailAndPassword, initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { addDoc, collection, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getSession } from "./auth.js";
import { normalizePermissions, permissionsWithin } from "./access.js";

const STAFF_APP = "ferretov-staff";
let staffAuth = null;

function creatorAuth() {
  if (staffAuth) return staffAuth;
  const existing = getApps().find((item) => item.name === STAFF_APP);
  const secondary = existing || initializeApp(app.options, STAFF_APP);
  staffAuth = initializeAuth(secondary, { persistence: inMemoryPersistence });
  return staffAuth;
}

export async function saveStaff(payload) {
  const session = getSession();
  if (!session?.uid) throw new Error("Debe iniciar sesión.");
  const action = payload?.action;
  if (action === "create") return createEmployee(session, payload);
  if (action === "update") return updateEmployee(session, payload);
  throw new Error("La operación no es válida.");
}

async function createEmployee(session, payload) {
  const email = cleanEmail(payload.email);
  const name = cleanName(payload.name);
  const password = String(payload.password || "");
  const role = cleanRole(session, payload.role);
  const permissions = cleanPermissions(session, payload.permissions);
  await assertCanCreate(session);
  const creator = creatorAuth();
  let uid = String(payload.uid || "");
  try {
    if (!uid) {
      if (password.length < 6) throw new Error("La contraseña inicial debe tener al menos 6 caracteres.");
      const existing = await findByEmail(email);
      if (existing) throw new Error("Ese correo ya tiene un perfil. Edítelo desde la lista; no se creará otra cuenta.");
      try {
        const cred = await createUserWithEmailAndPassword(creator, email, password);
        uid = cred.user.uid;
      } catch (error) {
        if (!String(error?.code || "").includes("email-already-in-use")) throw error;
        try {
          const cred = await signInWithEmailAndPassword(creator, email, password);
          uid = cred.user.uid;
        } catch {
          throw new Error("Ese correo ya existe en Authentication y la contraseña no coincide. No se creó otra cuenta. Escriba la misma contraseña inicial para completar el perfil. Para eliminar una cuenta sin perfil: Firebase Console, Authentication, Users.");
        }
      }
      await signOut(creator).catch(() => {});
    }
    assertPrimary(session, uid);
    if (!uid || uid === session.uid) throw new Error("No se puede usar la cuenta del propietario como empleado.");
    const ref = doc(db, "users", uid);
    const current = await getDoc(ref);
    if (current.exists()) throw new Error("Ese correo ya tiene un perfil. Edítelo desde la lista.");
    const now = Timestamp.now();
    await setDoc(ref, {
      email,
      name,
      role,
      active: true,
      status: "active",
      permissions,
      createdAt: now,
      updatedAt: now,
      createdBy: session.uid,
      lastAccessAt: null
    });
    const saved = await getDoc(ref);
    const data = saved.data();
    if (!saved.exists() || saved.id !== uid || data?.role !== role || data?.createdBy !== session.uid || !data?.permissions) {
      throw staffError("La cuenta de acceso existe, pero el perfil o los permisos no quedaron guardados. Pulse Guardar otra vez; no se creará otro correo.", { uid, recoverable: true });
    }
    assertPrimary(session, uid);
    await writeAudit(session, "user.create", uid, `${name} · ${role}`);
    return { uid };
  } catch (error) {
    if (error.recoverable) throw error;
    const code = String(error?.code || "");
    if (uid && code.includes("permission-denied")) {
      throw staffError("Firestore rechazó el perfil (permission-denied). La cuenta de acceso ya existe. Pulse Guardar otra vez para completar el perfil, sin crear otro correo.", { uid, recoverable: true });
    }
    throw explainStaffError(error, uid ? "profile" : "auth");
  } finally {
    await signOut(creator).catch(() => {});
  }
}

async function updateEmployee(session, payload) {
  const uid = String(payload.uid || "");
  if (!uid) throw new Error("Falta el usuario.");
  if (uid === session.uid) throw new Error("No puede modificar sus propios permisos desde aquí.");
  const name = cleanName(payload.name);
  const role = cleanRole(session, payload.role);
  const permissions = cleanPermissions(session, payload.permissions);
  const active = payload.active !== false;
  try {
    await updateDoc(doc(db, "users", uid), {
      name,
      role,
      active,
      status: active ? "active" : "inactive",
      permissions,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    throw explainStaffError(error, "permissions");
  }
  await writeAudit(session, "user.update", uid, `${name} · ${role} · ${active ? "activo" : "inactivo"}`);
  return { uid };
}

function staffError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

function assertPrimary(session, uid = "") {
  if (auth.currentUser?.uid !== session.uid) {
    throw staffError("La sesión del propietario cambió. No se creó otra cuenta. Pulse Guardar otra vez para completar el perfil.", { uid, recoverable: Boolean(uid) });
  }
}

async function assertCanCreate(session) {
  assertPrimary(session);
  const me = await getDoc(doc(db, "users", session.uid));
  if (!me.exists() || me.data().active === false) {
    throw new Error("Su usuario no puede crear empleados. No se creó ninguna cuenta.");
  }
  const data = me.data();
  const owner = data.role === "owner" || (data.role === "admin" && !data.permissions);
  const allowed = owner || (data.permissions?.settings?.users === true && data.permissions?.settings?.permissions === true);
  if (!allowed) throw new Error("No tiene permiso para crear empleados. No se creó ninguna cuenta.");
}

async function findByEmail(email) {
  const snap = await getDocs(query(collection(db, "users"), where("email", "==", email), limit(1)));
  return snap.docs[0] || null;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 120) throw new Error("Escriba un correo válido.");
  return email;
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (name.length < 2 || name.length > 80) throw new Error("Escriba el nombre del usuario.");
  return name;
}

function cleanRole(session, value) {
  if (value === "owner") throw new Error("El propietario principal no se puede asignar desde aquí.");
  if (value === "admin") {
    if (session.role !== "owner") throw new Error("Solo el propietario puede asignar administradores.");
    return "admin";
  }
  return "employee";
}

function cleanPermissions(session, value) {
  const permissions = normalizePermissions(value);
  if (!permissionsWithin(session.role, session.permissions, permissions)) {
    throw new Error("No puede otorgar permisos que usted no tiene.");
  }
  return permissions;
}

function explainStaffError(error, stage) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code.includes("email-already-in-use") || code.includes("email-already-exists")) return new Error("Ese correo ya está registrado.");
  if (code.includes("invalid-email")) return new Error("El correo no es válido.");
  if (code.includes("weak-password") || code.includes("invalid-password")) return new Error("La contraseña debe tener al menos 6 caracteres.");
  if (code.includes("operation-not-allowed")) return new Error("Firebase Authentication no tiene habilitado el acceso con correo y contraseña.");
  if (code.includes("configuration-not-found") || code.includes("invalid-api-key")) return new Error("Firebase Authentication no está habilitado en ferretov-74fae.");
  if (code.includes("network-request-failed") || code === "unavailable") return new Error("No hay conexión con Firebase. Intente de nuevo.");
  if (code.includes("unauthenticated") || code.includes("user-token-expired")) return new Error("La sesión expiró. Vuelva a iniciar sesión.");
  if (code.includes("permission-denied")) {
    if (stage === "profile") return new Error("Firestore rechazó el perfil (permission-denied). Si el correo ya existe, pulse Guardar otra vez para completar el perfil.");
    if (stage === "permissions") return new Error("Firestore rechazó el cambio de permisos.");
    return new Error("Firestore rechazó la operación por falta de permiso.");
  }
  if (message && !/manageStaff|cloud functions|internal/i.test(message)) return new Error(message);
  if (stage === "auth") return new Error("No se pudo crear la cuenta de acceso.");
  if (stage === "permissions") return new Error("No se pudo guardar los permisos.");
  return new Error("No se pudo guardar el perfil del usuario.");
}

async function writeAudit(session, action, targetId, detail) {
  await addDoc(collection(db, "auditLogs"), {
    action,
    module: "usuarios",
    targetId,
    detail,
    userId: session.uid,
    userName: session.name || "",
    at: Timestamp.now()
  }).catch(() => {});
}
