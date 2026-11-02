import { db } from "./firebase-config.js";
import { collection, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export function mapDocs(snap) {
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function readByDate(name, from, to, size = 400) {
  const snap = await getDocs(query(
    collection(db, name),
    where("dateKey", ">=", from),
    where("dateKey", "<=", to),
    orderBy("dateKey", "desc"),
    limit(size)
  ));
  return mapDocs(snap);
}

export async function readOrdered(name, field, direction = "asc", size = 200) {
  const snap = await getDocs(query(collection(db, name), orderBy(field, direction), limit(size)));
  return mapDocs(snap);
}
