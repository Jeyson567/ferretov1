import { db } from "./firebase-config.js";
import { can } from "./permissions.js";
import { applyTheme } from "./theme.js";
import { collection, getDocs, doc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const state = {
  settings: null,
  units: [],
  categories: [],
  methods: [],
  expenseCategories: []
};

export function getSettings() {
  return state.settings || {
    businessName: "FERRETOV",
    currencySymbol: "Q",
    allowNegativeStock: false,
    defaultMinStock: 5,
    maxDiscountPercent: 15,
    allowSellerPriceEdit: true,
    printFormat: "letter",
    logoUrl: "",
    themePreset: "ferretov",
    themePrimary: "#d4a017",
    themeSecondary: "#111111"
  };
}

export function getUnits() { return state.units; }
export function getCategories() { return state.categories; }
export function getMethods() { return state.methods; }
export function getExpenseCategories() { return state.expenseCategories; }

export async function loadCatalogs() {
  const jobs = [
    getDoc(doc(db, "settings", "general")),
    getDocs(query(collection(db, "units"), where("active", "==", true))),
    getDocs(query(collection(db, "categories"), where("active", "==", true))),
    getDocs(query(collection(db, "paymentMethods"), where("active", "==", true)))
  ];
  if (can("expenses.view") || can("expenses.create") || can("settings.categories")) jobs.push(getDocs(collection(db, "expenseCategories")));
  const [settingsSnap, unitsSnap, categoriesSnap, methodsSnap, expenseSnap] = await Promise.all(jobs);
  state.settings = settingsSnap.exists() ? settingsSnap.data() : getSettings();
  state.units = mapDocs(unitsSnap).sort(byName);
  state.categories = mapDocs(categoriesSnap).sort(byName);
  state.methods = mapDocs(methodsSnap).sort(byName);
  state.expenseCategories = expenseSnap ? mapDocs(expenseSnap).filter((item) => item.active !== false).sort(byName) : [];
  applyTheme(state.settings);
  return state;
}

function mapDocs(snap) {
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function byName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), "es");
}
