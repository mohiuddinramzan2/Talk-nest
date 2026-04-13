// ══════════════════════════════════════════════════════════════
//  app.js  —  TalkNest (সম্পূর্ণ নতুন)
// ══════════════════════════════════════════════════════════════

import { auth, db } from "./firebase-config.js";
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
  onSnapshot, addDoc, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Global State ───────────────────────────────────────────
let currentUser          = null;
let currentConvId        = null;
let currentPeerData      = null;
let messagesUnsub        = null;
let conversationsUnsub   = null;
let typingTimer          = null;
let groupMembers         = [];
let activeTab            = "chats";
let _profileUser         = null;

const DEFAULT_AVATAR = "https://api.dicebear.com/7.x/adventurer/svg?seed=";

// ══════════════════════════════════════════════════════════════
//  UTILITY
// ══════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

function showLoading(v) { $("loading").classList.toggle("hidden", !v); }

function showToast(msg, type = "info") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3000);
}

function esc(str = "") {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br/>");
}

function avatarUrl(u) {
  return (u && u.photoURL) ? u.photoURL : DEFAULT_AVATAR + encodeURIComponent((u && u.name) || "user");
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
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "গতকাল";
  return d.toLocaleDateString("bn-BD");
}

function getConvId(a, b) { return [a, b].sort().join("_"); }

function generateUID(name) {
  const base = name.toLowerCase().replace(/\s+/g,"").replace(/[^a-z0-9]/g,"") || "user";
  return base + Math.floor(1000 + Math.random() * 9000);
}

// ══════════════════════════════════════════════════════════════
//  AUTH — Tab Switch
// ══════════════════════════════════════════════════════════════

window.switchTab = function(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
  event.target.classList.add("active");
  $(`${tab}-form`).classList.add("active");
  $("auth-error").textContent = "";
};

// ── Username check ─────────────────────────────────────────
let usernameAvailable = false;
let usernameTimer = null;

window.checkUsername = async function() {
  const val = $("reg-username").value.trim().toLowerCase();
  const st  = $("username-status");
  usernameAvailable = false;
  st.textContent = "";
  if (!val) return;
  if (!/^[a-z0-9_]{3,20}$/.test(val)) { st.textContent = "❌"; return; }
  clearTimeout(usernameTimer);
  usernameTimer = setTimeout(async () => {
    const snap = await getDocs(query(collection(db, "users"), where("username","==",val)));
    usernameAvailable = snap.empty;
    st.textContent = snap.empty ? "✅" : "❌";
  }, 500);
};

// ── Register ───────────────────────────────────────────────
window.registerUser = async function() {
  const name  = $("reg-name").value.trim();
  const uname = $("reg-username").value.trim().toLowerCase();
  const email = $("reg-email").value.trim();
  const pass  = $("reg-password").value;
  const phone = $("reg-phone") ? $("reg-phone").value.trim() : "";
  const err   = $("auth-error");

  if (!name || !uname || !email || !pass) { err.textContent = "সব তথ্য পূরণ করুন।"; return; }
  if (!usernameAvailable) { err.textContent = "ইউজারনেম বেছে নিন (✅ না দেখা পর্যন্ত)।"; return; }
  if (pass.length < 6) { err.textContent = "পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে।"; return; }

  showLoading(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      name, username: uname, email,
      phone: phone || "",
      photoURL: DEFAULT_AVATAR + encodeURIComponent(name),
      bio: "", online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    showToast("রেজিস্ট্রেশন সফল! স্বাগতম 🎉", "success");
  } catch(e) {
    err.textContent = e.code === "auth/email-already-in-use" ? "এই ইমেইল আগেই ব্যবহার হয়েছে।" : e.message;
  } finally { showLoading(false); }
};

// ── Login ──────────────────────────────────────────────────
window.loginUser = async function() {
  const email = $("login-email").value.trim();
  const pass  = $("login-password").value;
  const err   = $("auth-error");
  if (!email || !pass) { err.textContent = "ইমেইল ও পাসওয়ার্ড দিন।"; return; }
  showLoading(true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    showToast("লগইন সফল!", "success");
  } catch(e) {
    err.textContent = e.code === "auth/invalid-credential" ? "ইমেইল বা পাসওয়ার্ড ভুল।" : e.message;
  } finally { showLoading(false); }
};

// ── Google Login ───────────────────────────────────────────
window.googleLogin = async function() {
  showLoading(true);
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const u = result.user;
    const snap = await getDoc(doc(db, "users", u.uid));
    if (!snap.exists()) {
      await setDoc(doc(db, "users", u.uid), {
        uid: u.uid,
        name: u.displayName || "ব্যবহারকারী",
        username: generateUID(u.displayName || "user"),
        email: u.email,
        phone: "",
        photoURL: u.photoURL || DEFAULT_AVATAR + u.uid,
        bio: "", online: true,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    }
    showToast("Google লগইন সফল!", "success");
  } catch(e) {
    $("auth-error").textContent = e.message;
  } finally { showLoading(false); }
};

// ── Logout ─────────────────────────────────────────────────
window.logoutUser = async function() {
  if (!confirm("লগআউট করবেন?")) return;
  await updateDoc(doc(db, "users", currentUser.uid), { online: false, lastSeen: serverTimestamp() }).catch(()=>{});
  await signOut(auth);
};

// ══════════════════════════════════════════════════════════════
//  AUTH STATE
// ══════════════════════════════════════════════════════════════

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await updateDoc(doc(db, "users", user.uid), { online: true }).catch(()=>{});
    loadApp();
  } else {
    currentUser = null;
    $("auth-screen").classList.add("active");
    $("app-screen").classList.remove("active");
    if (conversationsUnsub) conversationsUnsub();
    if (messagesUnsub) messagesUnsub();
  }
});

// ══════════════════════════════════════════════════════════════
//  LOAD APP
// ══════════════════════════════════════════════════════════════

async function loadApp() {
  $("auth-screen").classList.remove("active");
  $("app-screen").classList.add("active");
  showLoading(false);

  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const d = snap.data();
    if (!d) return;

    $("sidebar-name").textContent   = d.name;
    $("sidebar-uid").textContent    = "@" + d.username;
    $("sidebar-avatar-img").src     = avatarUrl(d);
    $("edit-name").value            = d.name;
    $("edit-bio").value             = d.bio || "";
    if ($("edit-phone")) $("edit-phone").value = d.phone || "";
    $("profile-uid-display").textContent = "@" + d.username;
    $("profile-avatar-img").src     = avatarUrl(d);
  } catch(e) { console.error(e); }

  listenConversations();
}

// ══════════════════════════════════════════════════════════════
//  CONVERSATIONS LISTENER
// ══════════════════════════════════════════════════════════════

function listenConversations() {
  if (conversationsUnsub) conversationsUnsub();

  const q = query(
    collection(db, "conversations"),
    where("members", "array-contains", currentUser.uid),
    orderBy("lastMessageAt", "desc")
  );

  conversationsUnsub = onSnapshot(q, async snap => {
    showLoading(false);
    const list = $("conversations-list");
    list.innerHTML = "";

    const convs = [];
    snap.forEach(d => convs.push({ id: d.id, ...d.data() }));

    for (const conv of convs) {
      if (activeTab === "chats"  && conv.type === "group") continue;
      if (activeTab === "groups" && conv.type !== "group") continue;

      let name, photo, peerData = null, peerUid = null;

      if (conv.type === "group") {
        name  = conv.groupName || "গ্রুপ";
        photo = DEFAULT_AVATAR + (conv.id || "group");
      } else {
        peerUid = conv.members.find(m => m !== currentUser.uid);
        try {
          const peerSnap = await getDoc(doc(db, "users", peerUid));
          peerData = peerSnap.data();
          name  = peerData?.name || "ব্যবহারকারী";
          photo = avatarUrl(peerData);
        } catch(e) { name = "ব্যবহারকারী"; photo = DEFAULT_AVATAR + peerUid; }
      }

      const unread = conv.unread?.[currentUser.uid] || 0;
      const isOnline = peerData?.online || false;

      const item = document.createElement("div");
      item.className = `conv-item${currentConvId === conv.id ? " active" : ""}`;
      item.dataset.convId = conv.id;
      item.innerHTML = `
        <div class="conv-avatar">
          <img src="${photo}" alt=""/>
          <span class="online-dot${isOnline ? "" : " offline"}"></span>
        </div>
        <div class="conv-info">
          <div class="conv-name">${esc(name)}</div>
          <div class="conv-last-msg">${esc(conv.lastMessage || "চ্যাট শুরু করুন")}</div>
        </div>
        <div class="conv-meta">
          <span class="conv-time">${formatTime(conv.lastMessageAt)}</span>
          ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ""}
        </div>`;

      const _convId = conv.id, _name = name, _photo = photo, _peerData = peerData, _peerUid = peerUid, _isGroup = conv.type === "group";
      item.onclick = () => openConversation(_convId, _name, _photo, _peerData, _peerUid, _isGroup);
      list.appendChild(item);
    }
  }, err => {
    console.error("Conversations error:", err);
    showLoading(false);
  });
}

// ══════════════════════════════════════════════════════════════
//  OPEN CONVERSATION
// ══════════════════════════════════════════════════════════════

async function openConversation(convId, name, photo, peerData, peerUid, isGroup) {
  currentConvId   = convId;
  currentPeerData = peerData;

  // Mobile: sidebar লুকাও
  $("sidebar").classList.add("hidden-mobile");
  $("empty-state").classList.add("hidden");
  $("chat-window").classList.remove("hidden");

  // Header আপডেট
  $("peer-avatar").src           = photo;
  $("peer-name").textContent     = name;
  const st = $("peer-status");
  if (peerData?.online) {
    st.textContent = "অনলাইন"; st.className = "status-text online";
  } else {
    st.textContent = peerData?.lastSeen ? "শেষবার: " + formatTime(peerData.lastSeen) : "অফলাইন";
    st.className = "status-text";
  }

  // Unread reset
  await updateDoc(doc(db, "conversations", convId), {
    [`unread.${currentUser.uid}`]: 0
  }).catch(()=>{});

  // Sidebar highlight
  document.querySelectorAll(".conv-item").forEach(el => {
    el.classList.toggle("active", el.dataset.convId === convId);
  });

  listenMessages(convId);
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES LISTENER
// ══════════════════════════════════════════════════════════════

function listenMessages(convId) {
  if (messagesUnsub) messagesUnsub();

  const q = query(
    collection(db, "conversations", convId, "messages"),
    orderBy("createdAt", "asc"),
    limit(100)
  );

  messagesUnsub = onSnapshot(q, snap => {
    const container = $("messages-list");
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
      container.appendChild(buildBubble(msg));
    });

    const mc = $("messages-container");
    mc.scrollTop = mc.scrollHeight;
  });

  // Typing listener
  onSnapshot(doc(db, "conversations", convId), snap => {
    const d = snap.data();
    const typing = d?.typing ? Object.keys(d.typing).filter(u => u !== currentUser.uid && d.typing[u]) : [];
    $("typing-indicator").classList.toggle("hidden", typing.length === 0);
  });
}

// ══════════════════════════════════════════════════════════════
//  BUILD MESSAGE BUBBLE
// ══════════════════════════════════════════════════════════════

function buildBubble(msg) {
  const isSent = msg.senderId === currentUser.uid;
  const wrap = document.createElement("div");
  wrap.className = `msg-bubble-wrap ${isSent ? "sent" : "received"}`;

  let content = "";
  if (msg.type === "image") {
    content = `<img class="msg-image" src="${msg.fileURL}" onclick="window.open('${msg.fileURL}','_blank')"/>`;
  } else if (msg.type === "file") {
    content = `<a class="msg-file-link" href="${msg.fileURL}" target="_blank">📄 ${esc(msg.fileName || "ফাইল")}</a>`;
  } else {
    content = esc(msg.text || "");
  }

  wrap.innerHTML = `
    ${!isSent ? `<img class="msg-avatar" src="${avatarUrl(currentPeerData)}" alt=""/>` : ""}
    <div>
      <div class="msg-bubble">${content}</div>
      <div class="msg-meta">${formatTime(msg.createdAt)} ${isSent ? (msg.read ? "✓✓" : "✓") : ""}</div>
    </div>`;
  return wrap;
}

// ══════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ══════════════════════════════════════════════════════════════

window.sendMessage = async function() {
  if (!currentConvId) { showToast("আগে কাউকে সিলেক্ট করুন।", "error"); return; }
  const input = $("message-input");
  const text  = input.value.trim();
  if (!text) return;
  input.value = "";
  clearTypingIndicator();

  try {
    await addDoc(collection(db, "conversations", currentConvId, "messages"), {
      text,
      senderId:   currentUser.uid,
      senderName: currentUser.displayName || "User",
      type:       "text",
      createdAt:  serverTimestamp(),
      read:       false
    });
    await updateDoc(doc(db, "conversations", currentConvId), {
      lastMessage:    text.length > 40 ? text.slice(0, 40) + "…" : text,
      lastMessageAt:  serverTimestamp(),
      [`unread.${currentPeerData?.uid || "group"}`]: increment(1)
    });
  } catch(e) {
    console.error(e);
    showToast("মেসেজ পাঠানো যায়নি।", "error");
  }
};

// ══════════════════════════════════════════════════════════════
//  TYPING
// ══════════════════════════════════════════════════════════════

window.handleTyping = function() {
  if (!currentConvId) return;
  updateDoc(doc(db, "conversations", currentConvId), {
    [`typing.${currentUser.uid}`]: true
  }).catch(()=>{});
  clearTimeout(typingTimer);
  typingTimer = setTimeout(clearTypingIndicator, 2000);
};

function clearTypingIndicator() {
  if (!currentConvId) return;
  clearTimeout(typingTimer);
  updateDoc(doc(db, "conversations", currentConvId), {
    [`typing.${currentUser.uid}`]: false
  }).catch(()=>{});
}

// ══════════════════════════════════════════════════════════════
//  USER SEARCH (sidebar)
// ══════════════════════════════════════════════════════════════

let searchTimer = null;
window.searchUsers = async function() {
  const val = $("search-input").value.trim().toLowerCase();
  const resultsEl = $("search-results");
  const convsEl   = $("conversations-list");

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
    try {
      const snap = await getDocs(query(
        collection(db, "users"),
        where("username", ">=", val),
        where("username", "<=", val + "\uf8ff"),
        limit(10)
      ));
      resultsEl.innerHTML = "";
      if (snap.empty) {
        resultsEl.innerHTML = "<p style='padding:10px;color:var(--text2);font-size:13px'>কেউ পাওয়া যায়নি।</p>";
        return;
      }
      snap.forEach(d => {
        const u = d.data();
        if (u.uid === currentUser.uid) return;
        const el = document.createElement("div");
        el.className = "search-result-item";
        el.innerHTML = `
          <img src="${avatarUrl(u)}" alt=""/>
          <div>
            <div style="font-size:14px;font-weight:600">${esc(u.name)}</div>
            <div style="font-size:12px;color:var(--accent);font-family:var(--mono)">@${u.username}</div>
          </div>
          <button class="start-chat-btn" onclick="showUserProfile('${u.uid}')">প্রোফাইল</button>`;
        resultsEl.appendChild(el);
      });
    } catch(e) { console.error(e); }
  }, 400);
};

// ══════════════════════════════════════════════════════════════
//  USER PROFILE MODAL
// ══════════════════════════════════════════════════════════════

window.showUserProfile = async function(uid) {
  showLoading(true);
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) { showToast("ব্যবহারকারী পাওয়া যায়নি।", "error"); return; }
    _profileUser = snap.data();

    $("up-avatar").src          = avatarUrl(_profileUser);
    $("up-name").textContent    = _profileUser.name || "---";
    $("up-uid").textContent     = "@" + (_profileUser.username || "---");
    $("up-bio").textContent     = _profileUser.bio || "কোনো বায়ো নেই।";
    $("up-phone").textContent   = _profileUser.phone ? "📞 +880 " + _profileUser.phone : "📞 নম্বর দেননি";
    $("up-status").textContent  = _profileUser.online ? "🟢 অনলাইন" : "⚫ অফলাইন";

    $("user-profile-modal").classList.remove("hidden");
  } catch(e) {
    console.error(e);
    showToast("প্রোফাইল লোড হয়নি।", "error");
  } finally {
    showLoading(false);
  }
};

window.openChatFromProfile = async function() {
  if (!_profileUser || !_profileUser.uid) {
    showToast("ব্যবহারকারীর তথ্য নেই।", "error");
    return;
  }
  $("user-profile-modal").classList.add("hidden");
  await startDirectChat(_profileUser);
};

// ══════════════════════════════════════════════════════════════
//  START DIRECT CHAT  ← মূল fix এখানে
// ══════════════════════════════════════════════════════════════

async function startDirectChat(peerUser) {
  if (!peerUser || !peerUser.uid) {
    showToast("ব্যবহারকারীর তথ্য পাওয়া যায়নি।", "error");
    return;
  }

  showLoading(true);
  try {
    const convId  = getConvId(currentUser.uid, peerUser.uid);
    const convRef = doc(db, "conversations", convId);
    const snap    = await getDoc(convRef);

    if (!snap.exists()) {
      await setDoc(convRef, {
        members:       [currentUser.uid, peerUser.uid],
        type:          "direct",
        lastMessage:   "",
        lastMessageAt: serverTimestamp(),
        unread:        { [currentUser.uid]: 0, [peerUser.uid]: 0 },
        createdAt:     serverTimestamp()
      });
    }

    // সব modal ও search বন্ধ করো
    document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
    const si = $("search-input");
    if (si) si.value = "";
    $("search-results").classList.add("hidden");
    $("conversations-list").style.display = "";

    // চ্যাট খোলো
    await openConversation(convId, peerUser.name, avatarUrl(peerUser), peerUser, peerUser.uid, false);

  } catch(e) {
    console.error("startDirectChat error:", e);
    showToast("চ্যাট শুরু করা যায়নি: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

// ══════════════════════════════════════════════════════════════
//  NEW CHAT MODAL — Find User
// ══════════════════════════════════════════════════════════════

let findTimer = null;
window.findUserByUsername = async function() {
  const val = $("find-user-input").value.trim().replace("@","").toLowerCase();
  const res = $("find-user-results");
  res.innerHTML = "";
  if (!val) return;
  clearTimeout(findTimer);
  findTimer = setTimeout(async () => {
    const snap = await getDocs(query(collection(db,"users"), where("username","==",val)));
    if (snap.empty) { res.innerHTML = "<p style='color:var(--text2);font-size:13px'>পাওয়া যায়নি।</p>"; return; }
    snap.forEach(d => {
      const u = d.data();
      if (u.uid === currentUser.uid) return;
      const el = document.createElement("div");
      el.className = "find-result-item";
      el.innerHTML = `
        <img src="${avatarUrl(u)}" alt=""/>
        <div>
          <div class="result-name">${esc(u.name)}</div>
          <div class="result-uid">@${u.username}</div>
        </div>
        <button class="start-chat-btn" onclick="startChatByUid('${u.uid}')">চ্যাট শুরু</button>`;
      res.appendChild(el);
    });
  }, 400);
};

window.startChatByUid = async function(uid) {
  showLoading(true);
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) { showToast("পাওয়া যায়নি।","error"); return; }
    await startDirectChat(snap.data());
  } catch(e) {
    showToast("সমস্যা হয়েছে।","error");
  } finally {
    showLoading(false);
  }
};

// ══════════════════════════════════════════════════════════════
//  GROUP CHAT
// ══════════════════════════════════════════════════════════════

window.findGroupMember = async function() {
  const val = $("group-find-input").value.trim().replace("@","").toLowerCase();
  const res = $("group-find-results");
  res.innerHTML = "";
  if (!val) return;
  const snap = await getDocs(query(collection(db,"users"), where("username","==",val)));
  if (snap.empty) { res.innerHTML = "<p style='color:var(--text2);font-size:13px'>পাওয়া যায়নি।</p>"; return; }
  snap.forEach(d => {
    const u = d.data();
    if (u.uid === currentUser.uid || groupMembers.find(m => m.uid === u.uid)) return;
    const el = document.createElement("div");
    el.className = "find-result-item";
    el.innerHTML = `
      <img src="${avatarUrl(u)}" alt=""/>
      <div><div class="result-name">${esc(u.name)}</div><div class="result-uid">@${u.username}</div></div>
      <button class="start-chat-btn" onclick="addGroupMember('${u.uid}','${u.name}')">যোগ করুন</button>`;
    res.appendChild(el);
  });
};

window.addGroupMember = function(uid, name) {
  if (groupMembers.find(m => m.uid === uid)) return;
  groupMembers.push({ uid, name });
  renderGroupMembers();
  $("group-find-input").value = "";
  $("group-find-results").innerHTML = "";
};

function renderGroupMembers() {
  $("group-members-preview").innerHTML = groupMembers.map(m =>
    `<div class="member-chip">${esc(m.name)} <button onclick="removeGroupMember('${m.uid}')">✕</button></div>`
  ).join("");
}

window.removeGroupMember = function(uid) {
  groupMembers = groupMembers.filter(m => m.uid !== uid);
  renderGroupMembers();
};

window.createGroup = async function() {
  const name = $("group-name-input").value.trim();
  if (!name) { showToast("গ্রুপের নাম দিন।","error"); return; }
  if (groupMembers.length < 1) { showToast("কমপক্ষে একজন মেম্বার যোগ করুন।","error"); return; }
  showLoading(true);
  const members = [currentUser.uid, ...groupMembers.map(m => m.uid)];
  const convRef = await addDoc(collection(db,"conversations"), {
    members, type: "group", groupName: name,
    admin: currentUser.uid,
    lastMessage: "গ্রুপ তৈরি হয়েছে",
    lastMessageAt: serverTimestamp(),
    unread: Object.fromEntries(members.map(uid => [uid, 0])),
    createdAt: serverTimestamp()
  });
  await addDoc(collection(db,"conversations",convRef.id,"messages"), {
    text: `${currentUser.displayName} গ্রুপ "${name}" তৈরি করেছেন।`,
    senderId: "system", type: "text", createdAt: serverTimestamp()
  });
  groupMembers = [];
  closeModal("new-chat-modal");
  showLoading(false);
  showToast(`"${name}" গ্রুপ তৈরি হয়েছে! 🎉`, "success");
};

// ══════════════════════════════════════════════════════════════
//  PROFILE UPDATE
// ══════════════════════════════════════════════════════════════

window.updateProfile = async function() {
  const name  = $("edit-name").value.trim();
  const bio   = $("edit-bio").value.trim();
  const phone = $("edit-phone") ? $("edit-phone").value.trim() : "";
  if (!name) { showToast("নাম দিন।","error"); return; }
  showLoading(true);
  await updateDoc(doc(db,"users",currentUser.uid), { name, bio, phone: phone||"" });
  await updateProfile(auth.currentUser, { displayName: name });
  $("sidebar-name").textContent = name;
  showToast("প্রোফাইল আপডেট হয়েছে!", "success");
  closeModal("profile-modal");
  showLoading(false);
};

window.uploadAvatar = async function() {
  showToast("ছবি আপলোড এখন বন্ধ আছে।","error");
};

// ══════════════════════════════════════════════════════════════
//  FILE (disabled)
// ══════════════════════════════════════════════════════════════

window.handleFileSelect = function() { showToast("ফাইল শেয়ার এখন বন্ধ আছে।","error"); };
window.clearFile = function() {
  $("file-preview").classList.add("hidden");
  $("file-input").value = "";
};

// ══════════════════════════════════════════════════════════════
//  EMOJI
// ══════════════════════════════════════════════════════════════

window.toggleEmojiPicker = function() {
  $("emoji-picker").classList.toggle("hidden");
};

$("emoji-picker").addEventListener("click", e => {
  const char = e.target.textContent.trim();
  if ([...char].length <= 2 && char) {
    $("message-input").value += char;
    $("message-input").focus();
    $("emoji-picker").classList.add("hidden");
  }
});

// ══════════════════════════════════════════════════════════════
//  UI CONTROLS
// ══════════════════════════════════════════════════════════════

window.closeChat = function() {
  $("chat-window").classList.add("hidden");
  $("empty-state").classList.remove("hidden");
  $("sidebar").classList.remove("hidden-mobile");
  currentConvId = null;
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
};

window.showNewChat   = function() { $("new-chat-modal").classList.remove("hidden"); };
window.showProfile   = function() { $("profile-modal").classList.remove("hidden"); };
window.closeModal    = function(id) { $(id).classList.add("hidden"); };
window.toggleInfo    = function() { showToast("শীঘ্রই আসছে!"); };

window.switchConvTab = function(tab) {
  activeTab = tab;
  document.querySelectorAll(".conv-tab").forEach(b => b.classList.remove("active"));
  event.target.classList.add("active");
  listenConversations();
};

window.switchModalTab = function(tab) {
  document.querySelectorAll(".modal-tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".modal-panel").forEach(p => p.classList.remove("active"));
  event.target.classList.add("active");
  $(`${tab}-chat-panel`).classList.add("active");
};

// Modal backdrop close
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m) m.classList.add("hidden"); });
});

// Online/offline on tab close
window.addEventListener("beforeunload", () => {
  if (currentUser) {
    updateDoc(doc(db,"users",currentUser.uid), { online: false, lastSeen: serverTimestamp() }).catch(()=>{});
  }
});
