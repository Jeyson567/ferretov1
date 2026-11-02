import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBnb1UDULDB9gD8lZ8NtWeewL_fD9SQJdA",
  authDomain: "ferretov-74fae.firebaseapp.com",
  projectId: "ferretov-74fae",
  storageBucket: "ferretov-74fae.firebasestorage.app",
  messagingSenderId: "904911365291",
  appId: "1:904911365291:web:1d701a78e5f3b048dd43ee"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
