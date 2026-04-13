// ══════════════════════════════════════════════════════════════
//  firebase-config.js
//  🔴 এখানে শুধু তোমার Firebase Project-এর config বসাতে হবে
//  নিচে ধাপে ধাপে বলা আছে কীভাবে পাবে
// ══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDomFf-Az4MFZqPlQl3XqiRZK-85kgT1yw",
  authDomain:        "talknest-f3113.firebaseapp.com",
  projectId:         "talknest-f3113",
  storageBucket:     "talknest-f3113.firebasestorage.app",
  messagingSenderId: "1081136266307",
  appId:             "1:1081136266307:web:93907aa86791d2eb9768f6"
};

const app = initializeApp(firebaseConfig);
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = null; // Storage ছাড়া চালানো হচ্ছে
