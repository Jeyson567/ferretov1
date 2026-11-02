import { db } from "../firebase-config.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defineRoute } from "../router.js";
import { esc, formatDateTime } from "../utils.js";
import { page, table } from "../ui.js";

defineRoute("/auditoria", { perm: "audit", title: "Auditoría", render: renderAudit });

async function renderAudit(root) {
  const snap = await getDocs(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(150)));
  const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  root.innerHTML = page({
    title: "Auditoría",
    subtitle: "Las ventas, anulaciones, ajustes y cambios importantes quedan registrados. Este historial no se borra desde el sistema.",
    body: table([
      { label: "Fecha", render: (row) => formatDateTime(row.createdAt) },
      { label: "Usuario", render: (row) => esc(row.userName) },
      { label: "Módulo", render: (row) => esc(row.module) },
      { label: "Acción", render: (row) => esc(row.action) },
      { label: "Detalle", render: (row) => esc(row.summary) }
    ], rows, "Todavía no hay actividad registrada.")
  });
}
