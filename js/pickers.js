import { db } from "./firebase-config.js";
import { collection, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { errorMessage, esc, money, normalize, qty } from "./utils.js";

function debounce(fn, wait = 220) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export async function searchProducts(term) {
  const needle = normalize(term);
  if (!needle) return [];
  const tasks = [
    getDocs(query(collection(db, "products"), where("codeLower", "==", needle), limit(5))),
    getDocs(query(collection(db, "products"), where("nameLower", ">=", needle), where("nameLower", "<=", `${needle}\uf8ff`), orderBy("nameLower"), limit(12)))
  ];
  if (term.trim().length >= 4) {
    tasks.push(getDocs(query(collection(db, "products"), where("barcode", "==", term.trim()), limit(4))));
  }
  const snaps = await Promise.all(tasks);
  const map = new Map();
  snaps.forEach((snap) => snap.docs.forEach((item) => map.set(item.id, { id: item.id, ...item.data() })));
  return [...map.values()].filter((item) => item.active !== false);
}

export function mountProductSearch(input, menu, onPick) {
  const paint = debounce(async () => {
    const term = input.value.trim();
    if (!term) {
      menu.hidden = true;
      return;
    }
    menu.hidden = false;
    menu.innerHTML = `<div class="suggest-empty">Buscando…</div>`;
    try {
      const rows = await searchProducts(term);
      if (!rows.length) {
        menu.innerHTML = `<div class="suggest-empty">No hay productos con ese dato.</div>`;
        return;
      }
      menu.innerHTML = rows.map((row, index) => `<button type="button" data-index="${index}"><strong>${esc(row.name)}</strong><small>${esc(row.code)} · ${qty(row.stock)} ${esc(row.unitName || "")} · ${money(row.price)}</small></button>`).join("");
      menu.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          onPick(rows[Number(button.dataset.index)]);
          menu.hidden = true;
          input.value = "";
        });
      });
    } catch (error) {
      menu.innerHTML = `<div class="suggest-empty">${esc(errorMessage(error))}</div>`;
    }
  });
  input.addEventListener("input", paint);
  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const rows = await searchProducts(input.value.trim());
    if (rows.length === 1 || rows[0]?.codeLower === normalize(input.value) || rows[0]?.barcode === input.value.trim()) {
      onPick(rows[0]);
      menu.hidden = true;
      input.value = "";
    } else {
      paint();
    }
  });
  return () => menu.replaceChildren();
}
