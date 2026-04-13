// ══════════════════════════════════════════════════════════════
//  app.js  —  TalkNest Main Application Logic
// ══════════════════════════════════════════════════════════════

import { auth, db, storage } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, getDocs, updateDoc,
  collection, query, where, orderBy, limit,
  onSnapshot, addDoc, serverTimestamp,
  arrayUnion, arrayRemove, increment, writeBatch,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// Storage disabled — ফাইল আপলোড পরে যোগ করা হবে

// ── State ──────────────────────────────────────────────────
let currentUser     = null;
let currentConvId   = null;
let currentPeerData = null;
let messagesListener = null;
let conversationsListener = null;
let typingTimeout   = null;
let selectedFile    = null;
let groupMembers    = [];
let activeConvTab   = "chats";

const DEFAULT_AVATAR = "https://api.dicebear.com/7.x/adventurer/svg?seed=";

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function showLoading(v) {
  document.getElementById("loading").classList.toggle("hidden", !v);
}

function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  setTimeout(() => t.classList.add("hidden"), 3000);
}

function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "আজ";
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "গতকাল";
  return d.toLocaleDateString("bn-BD");
}

function avatarUrl(user) {
  return user?.photoURL || DEFAULT_AVATAR + encodeURIComponent(user?.displayName || user?.uid || "user");
}

function generateUID(name) {
  const base = name.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
  return base + Math.floor(1000 + Math.random() * 9000);
}

function getConvId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

// ══════════════════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ══════════════════════════════════════════════════════════════

window.switchTab = function (tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
  document.querySelector(`.tab-btn:${tab === "login" ? "first" : "last"}-child`).classList.add("active");
  document.getElementById(`${tab}-form`).classList.add("active");
  document.getElementById("auth-error").textContent = "";
};

let usernameAvailable = false;
let usernameCheckTimer = null;

window.checkUsername = async function () {
  const val = document.getElementById("reg-username").value.trim().toLowerCase();
  const st  = document.getElementById("username-status");
  usernameAvailable = false;
  if (!val) { st.textContent = ""; return; }
  if (!/^[a-z0-9_]{3,20}$/.test(val)) {
    st.textContent = "❌"; return;
  }
  clearTimeout(usernameCheckTimer);
  usernameCheckTimer = setTimeout(async () => {
    const snap = await getDocs(query(collection(db, "users"), where("username", "==", val)));
    if (snap.empty) { st.textContent = "✅"; usernameAvailable = true; }
    else            { st.textContent = "❌"; usernameAvailable = false; }
  }, 500);
};

window.registerUser = async function () {
  const name  = document.getElementById("reg-name").value.trim();
  const uname = document.getElementById("reg-username").value.trim().toLowerCase();
  const email = document.getElementById("reg-email").value.trim();
  const pass  = document.getElementById("reg-password").value;
  const err   = document.getElementById("auth-error");

  if (!name || !uname || !email || !pass) { err.textContent = "সব তথ্য পূরণ করুন।"; return; }
  if (!usernameAvailable) { err.textContent = "ইউজারনেম বেছে নিন (সবুজ ✅ না দেখা পর্যন্ত)।"; return; }
  if (pass.length < 6)   { err.textContent = "পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে।"; return; }

  showLoading(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      name,
      username: uname,
      email,
      photoURL: DEFAULT_AVATAR + encodeURIComponent(name),
      bio: "",
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    showToast("রেজিস্ট্রেশন সফল! স্বাগতম 🎉", "success");
  } catch (e) {
    err.textContent = e.code === "auth/email-already-in-use"
      ? "এই ইমেইল আগেই ব্যবহার হয়েছে।" : e.message;
  } finally { showLoading(false); }
};

window.loginUser = async function () {
  const email = document.getElementById("login-email").value.trim();
  const pass  = document.getElementById("login-password").value;
  const err   = document.getElementById("auth-error");

  if (!email || !pass) { err.textContent = "ইমেইল ও পাসওয়ার্ড দিন।"; return; }
  showLoading(true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    showToast("লগইন সফল!", "success");
  } catch (e) {
    err.textContent = e.code === "auth/invalid-credential"
      ? "ইমেইল বা পাসওয়ার্ড ভুল।" : e.message;
  } finally { showLoading(false); }
};

window.googleLogin = async function () {
  showLoading(true);
  try {
    const provider = new GoogleAuthProvider();
    const result   = await signInWithPopup(auth, provider);
    const u = result.user;
    const snap = await getDoc(doc(db, "users", u.uid));
    if (!snap.exists()) {
      const username = generateUID(u.displayName || "user");
      await setDoc(doc(db, "users", u.uid), {
        uid: u.uid,
        name: u.displayName || "ব্যবহারকারী",
        username,
        email: u.email,
        photoURL: u.photoURL || DEFAULT_AVATAR + u.uid,
        bio: "",
        online: true,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    }
    showToast("Google লগইন সফল!", "success");
  } catch (e) {
    document.getElementById("auth-error").textContent = e.message;
  } finally { showLoading(false); }
};

window.logoutUser = async function () {
  if (!confirm("লগআউট করবেন?")) return;
  await updateDoc(doc(db, "users", currentUser.uid), { online: false, lastSeen: serverTimestamp() });
  await signOut(auth);
};

// ══════════════════════════════════════════════════════════════
//  AUTH STATE
// ══════════════════════════════════════════════════════════════

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await updateDoc(doc(db, "users", user.uid), { online: true }).catch(() => {});
    loadApp();
  } else {
    currentUser = null;
    document.getElementById("auth-screen").classList.add("active");
    document.getElementById("app-screen").classList.remove("active");
    if (conversationsListener) conversationsListener();
    if (messagesListener)      messagesListener();
  }
});

// ══════════════════════════════════════════════════════════════
//  LOAD APP
// ══════════════════════════════════════════════════════════════

async function loadApp() {
  document.getElementById("auth-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
  showLoading(false);

  const snap = await getDoc(doc(db, "users", currentUser.uid));
  const data = snap.data();

  // Sidebar
  document.getElementById("sidebar-name").textContent    = data.name;
  document.getElementById("sidebar-uid").textContent     = "@" + data.username;
  document.getElementById("sidebar-avatar-img").src      = avatarUrl(data);

  // Profile modal pre-fill
  document.getElementById("edit-name").value             = data.name;
  document.getElementById("edit-bio").value              = data.bio || "";
  document.getElementById("profile-uid-display").textContent = "@" + data.username;
  document.getElementById("profile-avatar-img").src      = avatarUrl(data);

  listenConversations();
}

// ══════════════════════════════════════════════════════════════
//  CONVERSATIONS LISTENER
// ══════════════════════════════════════════════════════════════

function listenConversations() {
  if (conversationsListener) conversationsListener();

  const q = query(
    collection(db, "conversations"),
    where("members", "array-contains", currentUser.uid),
    orderBy("lastMessageAt", "desc")
  );

  conversationsListener = onSnapshot(q, async (snap) => {
    showLoading(false);
    const list = document.getElementById("conversations-list");
    list.innerHTML = "";

    const convs = [];
    snap.forEach(d => convs.push({ id: d.id, ...d.data() }));

    for (const conv of convs) {
      if (activeConvTab === "chats" && conv.type === "group") continue;
      if (activeConvTab === "groups" && conv.type !== "group") continue;

      let name, photo, uid2 = null;
      if (conv.type === "group") {
        name  = conv.groupName;
        photo = conv.groupPhoto || DEFAULT_AVATAR + conv.id;
      } else {
        uid2 = conv.members.find(m => m !== currentUser.uid);
        const peer = await getDoc(doc(db, "users", uid2));
        const pd   = peer.data();
        name  = pd?.name || "ব্যবহারকারী";
        photo = avatarUrl(pd);
        conv._peerData = pd;
        conv._peerOnline = pd?.online || false;
      }

      const unread = conv.unread?.[currentUser.uid] || 0;
      const item = document.createElement("div");
      item.className = `conv-item${currentConvId === conv.id ? " active" : ""}`;
      item.dataset.convId = conv.id;
      item.innerHTML = `
        <div class="conv-avatar">
          <img src="${photo}" alt=""/>
          <span class="online-dot${conv._peerOnline ? "" : " offline"}"></span>
        </div>
        <div class="conv-info">
          <div class="conv-name">${name}</div>
          <div class="conv-last-msg">${conv.lastMessage || "চ্যাট শুরু করুন"}</div>
        </div>
        <div class="conv-meta">
          <span class="conv-time">${formatTime(conv.lastMessageAt)}</span>
          ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ""}
        </div>`;
      item.onclick = () => openConversation(conv.id, name, photo, conv._peerData, uid2, conv.type === "group");
      list.appendChild(item);
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  OPEN CONVERSATION
// ══════════════════════════════════════════════════════════════

async function openConversation(convId, name, photo, peerData, peerUid, isGroup) {
  currentConvId   = convId;
  currentPeerData = peerData;

  // On mobile, hide sidebar
  document.getElementById("sidebar").classList.add("hidden-mobile");
  document.getElementById("empty-state").classList.add("hidden");
  const win = document.getElementById("chat-window");
  win.classList.remove("hidden");

  // Header
  document.getElementById("peer-avatar").src = photo;
  document.getElementById("peer-name").textContent = name;

  if (peerData) {
    const st = document.getElementById("peer-status");
    if (peerData.online) { st.textContent = "অনলাইন"; st.className = "status-text online"; }
    else { st.textContent = "শেষবার: " + formatTime(peerData.lastSeen); st.className = "status-text"; }
  }

  // Mark read
  await updateDoc(doc(db, "conversations", convId), {
    [`unread.${currentUser.uid}`]: 0
  }).catch(() => {});

  // Highlight sidebar item
  document.querySelectorAll(".conv-item").forEach(el => {
    el.classList.toggle("active", el.dataset.convId === convId);
  });

  listenMessages(convId);
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES LISTENER
// ══════════════════════════════════════════════════════════════

function listenMessages(convId) {
  if (messagesListener) messagesListener();

  const q = query(
    collection(db, "conversations", convId, "messages"),
    orderBy("createdAt", "asc"),
    limit(100)
  );

  messagesListener = onSnapshot(q, (snap) => {
    const container = document.getElementById("messages-list");
    container.innerHTML = "";
    let lastDate = "";

    snap.forEach(d => {
      const msg = { id: d.id, ...d.data() };
      const dateStr = formatDate(msg.createdAt);
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        const sep = document.createElement("div");
        sep.className = "date-separator";
        sep.innerHTML = `<span>${dateStr}</span>`;
        container.appendChild(sep);
      }
      container.appendChild(buildMsgBubble(msg));
    });

    const mc = document.getElementById("messages-container");
    mc.scrollTop = mc.scrollHeight;
  });

  // Typing indicator
  onSnapshot(doc(db, "conversations", convId), (snap) => {
    const d = snap.data();
    const typingUids = d?.typing ? Object.keys(d.typing).filter(u => u !== currentUser.uid && d.typing[u]) : [];
    const ti = document.getElementById("typing-indicator");
    ti.classList.toggle("hidden", typingUids.length === 0);
  });
}

// ══════════════════════════════════════════════════════════════
//  BUILD MESSAGE BUBBLE
// ══════════════════════════════════════════════════════════════

function buildMsgBubble(msg) {
  const isSent = msg.senderId === currentUser.uid;
  const wrap   = document.createElement("div");
  wrap.className = `msg-bubble-wrap ${isSent ? "sent" : "received"}`;

  let contentHtml = "";
  if (msg.type === "image") {
    contentHtml = `<img class="msg-image" src="${msg.fileURL}" alt="ছবি" onclick="window.open('${msg.fileURL}','_blank')"/>`;
  } else if (msg.type === "file") {
    contentHtml = `<a class="msg-file-link" href="${msg.fileURL}" target="_blank">📄 ${msg.fileName || "ফাইল ডাউনলোড করুন"}</a>`;
  } else {
    contentHtml = escapeHtml(msg.text || "");
  }

  wrap.innerHTML = `
    ${!isSent ? `<img class="msg-avatar" src="${avatarUrl(currentPeerData)}" alt=""/>` : ""}
    <div>
      <div class="msg-bubble">${contentHtml}</div>
      <div class="msg-meta">${formatTime(msg.createdAt)} ${isSent ? (msg.read ? "✓✓" : "✓") : ""}</div>
    </div>`;
  return wrap;
}

function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br/>");
}

// ══════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ══════════════════════════════════════════════════════════════

window.sendMessage = async function () {
  if (!currentConvId) return;
  const input = document.getElementById("message-input");
  const text  = input.value.trim();

  if (!text && !selectedFile) return;
  input.value = "";
  clearTyping();

  if (selectedFile) {
    await sendFile();
    return;
  }

  const msgData = {
    text,
    senderId: currentUser.uid,
    senderName: currentUser.displayName,
    type: "text",
    createdAt: serverTimestamp(),
    read: false
  };

  try {
    await addDoc(collection(db, "conversations", currentConvId, "messages"), msgData);
    await updateDoc(doc(db, "conversations", currentConvId), {
      lastMessage: text.length > 40 ? text.slice(0, 40) + "…" : text,
      lastMessageAt: serverTimestamp(),
      [`unread.${currentPeerData?.uid || "group"}`]: increment(1)
    });
  } catch (e) { showToast("মেসেজ পাঠানো যায়নি।", "error"); }
};

// ══════════════════════════════════════════════════════════════
//  FILE SEND
// ══════════════════════════════════════════════════════════════

window.handleFileSelect = function () {
  const file = document.getElementById("file-input").files[0];
  if (!file) return;
  selectedFile = file;
  const preview = document.getElementById("file-preview");
  preview.classList.remove("hidden");
  if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" alt=""/><span>${file.name}</span><button onclick="clearFile()">✕</button>`;
  } else {
    preview.innerHTML = `<span>📄 ${file.name}</span><button onclick="clearFile()">✕</button>`;
  }
};

window.clearFile = function () {
  selectedFile = null;
  document.getElementById("file-preview").classList.add("hidden");
  document.getElementById("file-input").value = "";
};

async function sendFile() {
  showToast("ফাইল শেয়ার এখন বন্ধ আছে। Storage চালু হলে কাজ করবে।", "error");
  clearFile();
}

// ══════════════════════════════════════════════════════════════
//  TYPING INDICATOR
// ══════════════════════════════════════════════════════════════

window.handleTyping = function () {
  if (!currentConvId) return;
  updateDoc(doc(db, "conversations", currentConvId), {
    [`typing.${currentUser.uid}`]: true
  }).catch(() => {});
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTyping, 2000);
};

function clearTyping() {
  if (!currentConvId) return;
  clearTimeout(typingTimeout);
  updateDoc(doc(db, "conversations", currentConvId), {
    [`typing.${currentUser.uid}`]: false
  }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════
//  SEARCH USERS
// ══════════════════════════════════════════════════════════════

let searchTimer = null;
window.searchUsers = async function () {
  const val = document.getElementById("search-input").value.trim().toLowerCase();
  const resultsEl = document.getElementById("search-results");
  const convsEl   = document.getElementById("conversations-list");

  if (!val) {
    resultsEl.classList.add("hidden");
    convsEl.style.display = "";
    return;
  }

  convsEl.style.display = "none";
  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = "<p style='padding:10px;color:var(--text2);font-size:13px'>খোঁজা হচ্ছে...</p>";

  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const snap = await getDocs(query(collection(db, "users"), where("username", ">=", val), where("username", "<=", val + "\uf8ff"), limit(10)));
    resultsEl.innerHTML = "";
    if (snap.empty) { resultsEl.innerHTML = "<p style='padding:10px;color:var(--text2);font-size:13px'>কোনো ব্যবহারকারী পাওয়া যায়নি।</p>"; return; }
    snap.forEach(d => {
      const u = d.data();
      if (u.uid === currentUser.uid) return;
      const el = document.createElement("div");
      el.className = "search-result-item";
      el.innerHTML = `<img src="${avatarUrl(u)}" alt=""/><div><div style="font-size:14px;font-weight:600">${u.name}</div><div style="font-size:12px;color:var(--accent);font-family:var(--mono)">@${u.username}</div></div>`;
      el.onclick = () => startDirectChat(u);
      resultsEl.appendChild(el);
    });
  }, 400);
};

// ══════════════════════════════════════════════════════════════
//  START DIRECT CHAT
// ══════════════════════════════════════════════════════════════

async function startDirectChat(peerUser) {
  showLoading(true);
  const convId = getConvId(currentUser.uid, peerUser.uid);
  const convRef = doc(db, "conversations", convId);
  const snap    = await getDoc(convRef);

  if (!snap.exists()) {
    await setDoc(convRef, {
      members: [currentUser.uid, peerUser.uid],
      type: "direct",
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      unread: { [currentUser.uid]: 0, [peerUser.uid]: 0 },
      createdAt: serverTimestamp()
    });
  }

  // Close modal / search
  closeModal("new-chat-modal");
  document.getElementById("search-input").value = "";
  document.getElementById("search-results").classList.add("hidden");
  document.getElementById("conversations-list").style.display = "";

  showLoading(false);
  openConversation(convId, pe
