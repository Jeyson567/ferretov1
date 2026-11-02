import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { allPermissions } from "./access.js";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_METHODS, DEFAULT_UNITS, defaultSettings } from "./defaults.js";
import { errorMessage } from "./utils.js";

let session = null;
let ready = null;
const listeners = new Set();

export function getSession() {
  return session;
}

export function onSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish() {
  listeners.forEach((listener) => listener(session));
}

export function watchAuth(handler) {
  ready = handler;
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      session = null;
      publish();
      handler({ status: "signed-out" });
      return;
    }
    handler({ status: "checking" });
    try {
      const profileRef = doc(db, "users", user.uid);
      const profileSnap = await getDoc(profileRef);
      const systemSnap = await getDoc(doc(db, "settings", "system"));
      const initialized = systemSnap.exists() && systemSnap.data().initialized === true;
      if (!profileSnap.exists()) {
        if (!initialized) {
          handler({ status: "setup", user });
          return;
        }
        const inviteSnap = await getDoc(doc(db, "invites", user.email.toLowerCase()));
        if (!inviteSnap.exists()) {
          session = null;
          handler({ status: "denied", reason: "Su correo no tiene una invitación activa." });
          return;
        }
        await acceptInvite(user, inviteSnap.data());
      }
      const fresh = (await getDoc(profileRef)).data();
      if (!fresh?.active) {
        session = null;
        handler({ status: "denied", reason: "Este usuario está desactivado. Solicite acceso al administrador." });
        return;
      }
      if (!initialized && (fresh.role === "owner" || fresh.role === "admin")) {
        session = toSession(user, fresh);
        handler({ status: "setup", user, resume: true });
        return;
      }
      session = toSession(user, fresh);
      publish();
      handler({ status: "ready", session });
      setDoc(profileRef, { lastAccessAt: Timestamp.now() }, { merge: true }).catch(() => {});
    } catch (error) {
      session = null;
      handler({ status: "error", message: errorMessage(error), error });
    }
  });
}

function toSession(user, profile) {
  return {
    uid: user.uid,
    email: user.email,
    name: profile.name || user.email,
    role: profile.role,
    active: profile.active !== false,
    permissions: profile.permissions || null
  };
}

export async function login(email, password) {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerAccount(email, password) {
  await createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function logout() {
  session = null;
  publish();
  await signOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

async function acceptInvite(user, invite) {
  const now = Timestamp.now();
  await setDoc(doc(db, "users", user.uid), {
    email: user.email,
    name: invite.name || user.email,
    role: invite.role,
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy: invite.createdBy || null
  });
  await setDoc(doc(db, "invites", user.email.toLowerCase()), { accepted: true, acceptedAt: serverTimestamp() }, { merge: true });
}

export async function setupBusiness(user, input) {
  const now = Timestamp.now();
  const profileRef = doc(db, "users", user.uid);
  const existing = await getDoc(profileRef);
  if (!existing.exists()) {
    await setDoc(profileRef, {
      email: user.email,
      name: input.adminName.trim(),
      role: "owner",
      active: true,
      status: "active",
      permissions: allPermissions(),
      createdAt: now,
      updatedAt: now,
      createdBy: user.uid
    });
  } else if (existing.data().role !== "owner" && existing.data().role !== "admin") {
    throw new Error("Solo el propietario puede completar la configuración inicial.");
  } else if (existing.data().role !== "owner") {
    await setDoc(profileRef, { role: "owner", permissions: allPermissions(), active: true, updatedAt: now }, { merge: true });
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "settings", "general"), {
    ...defaultSettings(input),
    updatedAt: now
  }, { merge: true });
  batch.set(doc(db, "settings", "system"), {
    initialized: true,
    initializedAt: now,
    initializedBy: user.uid,
    ownerUid: user.uid
  }, { merge: true });
  batch.set(doc(db, "counters", "main"), {
    sale: 0,
    quote: 0,
    entry: 0,
    payment: 0,
    expense: 0,
    return: 0
  }, { merge: true });
  DEFAULT_UNITS.forEach(([id, name, symbol]) => {
    batch.set(doc(db, "units", id), { name, symbol, active: true, createdAt: now }, { merge: true });
  });
  DEFAULT_METHODS.forEach(([id, name, code, requiresReference, locked]) => {
    batch.set(doc(db, "paymentMethods", id), {
      name, code, requiresReference, locked, active: true, createdAt: now
    }, { merge: true });
  });
  DEFAULT_EXPENSE_CATEGORIES.forEach(([id, name]) => {
    batch.set(doc(db, "expenseCategories", id), { name, active: true, createdAt: now }, { merge: true });
  });
  await batch.commit();
  session = {
    uid: user.uid,
    email: user.email,
    name: input.adminName.trim(),
    role: "owner",
    active: true,
    permissions: allPermissions()
  };
  publish();
}
