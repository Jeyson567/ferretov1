import { db } from "../firebase-config.js";
import { collection, getDocs, limit, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { readByDate } from "../lists.js";
import { dateKey, esc, formatDateTime, monthRange, qty } from "../utils.js";
import { page, table } from "../ui.js";

defineRoute("/movimientos", { perm: "movements", title: "Movimientos", render: renderMovements });

const LABELS = { initial: "Inventario inicial", entry: "Entrada", sale: "Venta", return: "Devolución", adjustment: "Ajuste" };

async function renderMovements(root) {
  const month = monthRange(dateKey());
  let from = month.start;
  let to = dateKey();
  const load = async () => {
    let rows = [];
    try { rows = await readByDate("inventoryMovements", from, to, 300); }
    catch {
      const snap = await getDocs(query(collection(db, "inventoryMovements"), limit(200)));
      rows = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.dateKey >= from && item.dateKey <= to);
    }
    rows.sort((a, b) => (b.at || 0) - (a.at || 0));
    const type = root.querySelector("#type")?.value || "";
    const term = (root.querySelector("#q")?.value || "").trim().toLowerCase();
    const visible = rows.filter((row) => (!type || row.type === type) && (!term || `${row.productName} ${row.productCode} ${row.referenceNumber}`.toLowerCase().includes(term)));
    root.innerHTML = page({
      title: "Movimientos de inventario",
      subtitle: "Entradas, ventas, devoluciones, ajustes e inventario inicial.",
      body: `<div class="filters"><label class="field"><span>Desde</span><input type="date" id="from" value="${from}"></label><label class="field"><span>Hasta</span><input type="date" id="to" value="${to}"></label><label class="field"><span>Tipo</span><select id="type"><option value="">Todos</option>${Object.entries(LABELS).map(([key, label]) => `<option value="${key}" ${key === type ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>Buscar</span><input id="q" value="${esc(term)}"></label><button class="btn btn-primary" id="apply" type="button">Consultar</button></div>
        ${table([
          { label: "Fecha", render: (row) => formatDateTime(row.date) },
          { label: "Producto", render: (row) => esc(row.productName) },
          { label: "Tipo", render: (row) => LABELS[row.type] || esc(row.type) },
          { label: "Cantidad", class: "num", render: (row) => qty(row.quantity) },
          { label: "Saldo", class: "num", render: (row) => qty(row.newStock) },
          { label: "Motivo", render: (row) => esc(row.reason || "") },
          { label: "Referencia", render: (row) => esc(row.referenceNumber || "") },
          { label: "Usuario", render: (row) => esc(row.userName || "") }
        ], visible, "No hay movimientos en ese período.")}`
    });
    root.querySelector("#apply").addEventListener("click", () => { from = root.querySelector("#from").value; to = root.querySelector("#to").value; load(); });
  };
  await load();
}
