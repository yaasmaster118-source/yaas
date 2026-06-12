const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const STORAGE_KEY = "yaas-v1-state";
const ACCOUNTS_KEY = "yaas-v1-accounts";
const SESSION_KEY = "yaas-v1-session";
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

const defaultState = {
  profile: { name: "Ali Mert", handle: "@alimert", role: "İçerik üretici" },
  settings: { reduceMotion: false, sound: true, autoplay: false },
  servers: [],
  posts: {},
  customPosts: []
};

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      ...defaultState,
      ...stored,
      profile: { ...defaultState.profile, ...stored?.profile },
      settings: { ...defaultState.settings, ...stored?.settings },
      posts: stored?.posts || {},
      servers: stored?.servers || [],
      customPosts: stored?.customPosts || []
    };
  } catch {
    return structuredClone(defaultState);
  }
}

let state = loadState();
let selectedMedia = null;
let selectedServerColor = "purple";
const toast = $(".toast");
const mediaInput = $("#media-input");
const mediaPreview = $("#media-preview");

function loadAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || [];
  } catch {
    return [];
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

async function hashPassword(password) {
  if (crypto.subtle) {
    const bytes = new TextEncoder().encode(`YAAS-1.0:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const character of `YAAS-1.0:${password}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function setSession(account, remember = true) {
  const session = { accountId: account.id, email: account.email };
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function switchAuthTab(tabName) {
  $$("[data-auth-tab]").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tabName));
  $("#login-form").classList.toggle("active", tabName === "login");
  $("#register-form").classList.toggle("active", tabName === "register");
  $("#auth-title").textContent = tabName === "login" ? "Tekrar hoş geldin" : "YAAS'a katıl";
  $("#auth-subtitle").textContent = tabName === "login"
    ? "Topluluğuna kaldığın yerden devam et."
    : "Hesabını oluştur ve topluluğunu kurmaya başla.";
  $(".auth-divider").style.display = "flex";
  $(".social-auth").style.display = "grid";
  $("#login-error").textContent = "";
  $("#register-error").textContent = "";
}

function enterApp(account) {
  if (account) {
    state.profile.name = account.name;
    state.profile.handle = account.handle;
    state.profile.role = account.role || state.profile.role;
    saveState();
    applyProfile();
  }
  $("#auth-screen").classList.add("hidden");
}

function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  switchAuthTab("login");
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    notify("Depolama alanı doldu. Daha küçük bir medya dosyası dene.");
    return false;
  }
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 2100);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function getInitials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("tr") || "Y";
}

function openModal(id) {
  const layer = $(`#${id}`);
  layer.hidden = false;
  const firstInput = $("input:not(.switch)", layer);
  setTimeout(() => firstInput?.focus(), 0);
}

function closeModal(layer) {
  layer.hidden = true;
}

function applyProfile() {
  const initials = getInitials(state.profile.name);
  $("#profile-name").textContent = state.profile.name;
  $("#profile-handle").textContent = state.profile.handle;
  $("#profile-role").textContent = state.profile.role;
  $("#profile-initials").textContent = initials;
  $$(".profile-mobile").forEach((element) => { element.textContent = initials; });
  $$(".avatar.lime").forEach((element) => { element.textContent = initials[0]; });
}

function applySettings() {
  $("#reduce-motion-setting").checked = state.settings.reduceMotion;
  $("#sound-setting").checked = state.settings.sound;
  $("#autoplay-setting").checked = state.settings.autoplay;
  document.body.classList.toggle("reduce-motion", state.settings.reduceMotion);
}

function createServerElement(server) {
  const button = document.createElement("button");
  button.className = "server custom-server";
  button.type = "button";
  button.dataset.server = server.name;
  button.dataset.serverId = server.id;
  button.innerHTML = `<span class="server-logo ${server.color}">${escapeHtml(getInitials(server.name))}</span><span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(server.topic)} · yeni sunucu</small></span>`;
  return button;
}

function renderCustomServers() {
  $$(".custom-server").forEach((server) => server.remove());
  const list = $(".server-list");
  state.servers.forEach((server) => list.append(createServerElement(server)));
  wireServers();
}

function getPostState(id) {
  if (!state.posts[id]) state.posts[id] = { liked: false, saved: false, comments: [] };
  return state.posts[id];
}

function updateSavedCount() {
  $("#saved-count").textContent = Object.values(state.posts).filter((post) => post.saved).length;
}

function wirePost(post) {
  if (post.dataset.wired === "true") return;
  post.dataset.wired = "true";
  const id = post.dataset.postId;
  const postState = getPostState(id);
  const like = $(".like-button", post);
  const save = $(".save-button", post);
  const comments = $(".comments", post);
  const commentForm = $(".comment-form", post);
  const baseLikes = Number(like?.dataset.baseLikes || $("b", like)?.textContent || 0);

  if (postState.liked && like) {
    like.classList.add("active");
    $("span", like).textContent = "♥";
    $("b", like).textContent = baseLikes + 1;
  }
  if (postState.saved && save) {
    save.classList.add("active");
    $("span", save).textContent = "♣";
  }

  postState.comments.forEach((text) => addCommentElement(commentForm, text));

  like?.addEventListener("click", () => {
    postState.liked = !postState.liked;
    like.classList.toggle("active", postState.liked);
    $("span", like).textContent = postState.liked ? "♥" : "♡";
    $("b", like).textContent = baseLikes + (postState.liked ? 1 : 0);
    saveState();
  });

  save?.addEventListener("click", () => {
    postState.saved = !postState.saved;
    save.classList.toggle("active", postState.saved);
    $("span", save).textContent = postState.saved ? "♣" : "♧";
    updateSavedCount();
    saveState();
    notify(postState.saved ? "Gönderi kaydedildi" : "Kayıtlardan çıkarıldı");
  });

  $(".comment-toggle", post)?.addEventListener("click", () => {
    $("input", comments)?.focus();
    comments.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  commentForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("input", commentForm);
    const text = input.value.trim();
    if (!text) return;
    postState.comments.push(text);
    addCommentElement(commentForm, text);
    input.value = "";
    saveState();
  });
}

function addCommentElement(form, text) {
  const comment = document.createElement("div");
  comment.className = "comment user-comment";
  comment.innerHTML = `<span class="avatar lime">${escapeHtml(getInitials(state.profile.name)[0])}</span><div><strong>${escapeHtml(state.profile.name)}</strong><p>${escapeHtml(text)}</p><small>Şimdi · Beğen · Yanıtla</small></div>`;
  form.before(comment);
}

function customPostTemplate(post) {
  const media = post.media
    ? post.media.type.startsWith("video/")
      ? `<div class="post-media uploaded"><video class="uploaded-media" controls src="${post.media.data}"></video></div>`
      : `<div class="post-media uploaded"><img class="uploaded-media" src="${post.media.data}" alt="${escapeHtml(state.profile.name)} paylaşımı"></div>`
    : "";
  return `
    <header class="post-head"><span class="avatar lime">${escapeHtml(getInitials(state.profile.name)[0])}</span><div><strong>${escapeHtml(state.profile.name)}</strong><span>YAAS Studio · ${post.time}</span></div><button type="button" aria-label="Gönderi menüsü">•••</button></header>
    ${post.text ? `<p class="post-copy">${escapeHtml(post.text).replace(/\n/g, "<br>")}</p>` : ""}
    ${media}
    <div class="post-stats"><span>Topluluğunla paylaşıldı</span><span>${getPostState(post.id).comments.length} yorum</span></div>
    <div class="post-actions"><button class="like-button" data-base-likes="0" type="button"><span>♡</span> Beğen <b>0</b></button><button class="comment-toggle" type="button"><span>◯</span> Yorum</button><button type="button"><span>↗</span> Paylaş</button><button class="save-button" type="button"><span>♧</span> Kaydet</button></div>
    <div class="comments"><form class="comment-form"><span class="avatar lime">${escapeHtml(getInitials(state.profile.name)[0])}</span><input placeholder="Yorum yaz..."><button type="submit">➤</button></form></div>`;
}

function renderCustomPosts() {
  state.customPosts.slice().reverse().forEach((data) => {
    const post = document.createElement("article");
    post.className = "post card custom-post";
    post.dataset.postId = data.id;
    post.innerHTML = customPostTemplate(data);
    $("#posts").prepend(post);
    wirePost(post);
  });
}

function wireServers() {
  $$(".server").forEach((server) => {
    if (server.dataset.wired === "true") return;
    server.dataset.wired = "true";
    server.addEventListener("click", () => {
      $$(".server").forEach((item) => item.classList.remove("active"));
      server.classList.add("active");
      $("#server-title").textContent = server.dataset.server.toLocaleUpperCase("tr");
      $(".servers").classList.remove("open");
      notify(`${server.dataset.server} sunucusuna geçtin`);
    });
  });
}

$$("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => switchAuthTab(button.dataset.authTab));
});

$$(".password-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const input = $("input", button.parentElement);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-label", show ? "Şifreyi gizle" : "Şifreyi göster");
  });
});

$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#register-name").value.trim();
  const email = $("#register-email").value.trim().toLocaleLowerCase("tr");
  const password = $("#register-password").value;
  const error = $("#register-error");
  const accounts = loadAccounts();
  if (accounts.some((account) => account.email === email)) {
    error.textContent = "Bu e-posta ile daha önce hesap oluşturulmuş.";
    return;
  }
  if (password.length < 6) {
    error.textContent = "Şifre en az 6 karakter olmalı.";
    return;
  }
  const account = {
    id: `account-${Date.now()}`,
    name,
    email,
    handle: `@${email.split("@")[0].replace(/[^a-z0-9._]/gi, "").slice(0, 20) || "yaasuye"}`,
    role: "YAAS üyesi",
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString()
  };
  accounts.push(account);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  setSession(account, true);
  form.reset();
  enterApp(account);
  notify("Hesabın oluşturuldu. YAAS'a hoş geldin!");
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $("#login-email").value.trim().toLocaleLowerCase("tr");
  const passwordHash = await hashPassword($("#login-password").value);
  const account = loadAccounts().find((item) => item.email === email && item.passwordHash === passwordHash);
  if (!account) {
    $("#login-error").textContent = "E-posta veya şifre yanlış.";
    return;
  }
  setSession(account, $("#remember-login").checked);
  form.reset();
  enterApp(account);
  notify(`Hoş geldin, ${account.name.split(" ")[0]}!`);
});

$(".forgot-button").addEventListener("click", () => {
  const email = $("#login-email").value.trim().toLocaleLowerCase("tr");
  $("#login-error").textContent = email
    ? "1.0 demosunda şifre sıfırlama e-postası gönderilmez."
    : "Önce hesabının e-posta adresini yaz.";
});

$$(".oauth-button").forEach((button) => {
  button.addEventListener("click", () => {
    const provider = button.classList.contains("google-auth") ? "Google" : "Apple";
    notify(`${provider} girişi için yayın alan adı ve OAuth anahtarı bağlanacak.`);
  });
});

$(".logout-button").addEventListener("click", () => {
  leaveVoiceRoom();
  clearSession();
  $(".profile").classList.remove("open");
  showAuth();
  notify("Oturum kapatıldı");
});

$$(".post").forEach((post, index) => {
  post.dataset.postId = `featured-${index + 1}`;
  const like = $(".like-button", post);
  if (like) like.dataset.baseLikes = $("b", like)?.textContent || "0";
});

applyProfile();
applySettings();
renderCustomServers();
renderCustomPosts();
$$(".post").forEach(wirePost);
updateSavedCount();

const activeSession = loadSession();
const activeAccount = activeSession
  ? loadAccounts().find((account) => account.id === activeSession.accountId)
  : null;
if (activeAccount) {
  enterApp(activeAccount);
} else {
  clearSession();
  showAuth();
}

$(".media-picker").addEventListener("click", () => mediaInput.click());
mediaInput.addEventListener("change", () => {
  const file = mediaInput.files[0];
  if (!file) return;
  if (file.size > MAX_MEDIA_BYTES) {
    mediaInput.value = "";
    notify("1.0 demosunda medya dosyası en fazla 3 MB olabilir.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    selectedMedia = { type: file.type, data: reader.result };
    const media = file.type.startsWith("video/")
      ? `<video controls src="${reader.result}"></video>`
      : `<img src="${reader.result}" alt="Paylaşım önizlemesi">`;
    mediaPreview.innerHTML = `${media}<button class="remove-media" type="button" aria-label="Medyayı kaldır">×</button>`;
    mediaPreview.classList.add("active");
    $(".remove-media").addEventListener("click", clearMedia);
  };
  reader.readAsDataURL(file);
});

function clearMedia() {
  selectedMedia = null;
  mediaInput.value = "";
  mediaPreview.innerHTML = "";
  mediaPreview.classList.remove("active");
}

$(".share-button").addEventListener("click", () => {
  const text = $("#post-text").value.trim();
  if (!text && !selectedMedia) {
    notify("Önce bir yazı, fotoğraf veya video ekle");
    return;
  }
  const data = {
    id: `post-${Date.now()}`,
    text,
    media: selectedMedia,
    time: "Şimdi"
  };
  state.customPosts.push(data);
  getPostState(data.id);
  if (!saveState()) {
    state.customPosts.pop();
    delete state.posts[data.id];
    return;
  }
  const post = document.createElement("article");
  post.className = "post card custom-post";
  post.dataset.postId = data.id;
  post.innerHTML = customPostTemplate(data);
  $("#posts").prepend(post);
  wirePost(post);
  $("#post-text").value = "";
  clearMedia();
  post.scrollIntoView({ behavior: "smooth", block: "start" });
  notify("Gönderin paylaşıldı");
});

$(".create-server").addEventListener("click", () => openModal("server-modal"));
$(".edit-profile-button").addEventListener("click", () => {
  $("#edit-name").value = state.profile.name;
  $("#edit-handle").value = state.profile.handle;
  $("#edit-role").value = state.profile.role;
  openModal("profile-modal");
});
$(".settings-button").addEventListener("click", () => openModal("settings-modal"));

$$(".modal-close").forEach((button) => {
  button.addEventListener("click", () => closeModal(button.closest(".modal-layer")));
});
$$(".modal-layer").forEach((layer) => {
  layer.addEventListener("click", (event) => {
    if (event.target === layer) closeModal(layer);
  });
});

$$(".color-choice").forEach((choice) => {
  choice.addEventListener("click", () => {
    $$(".color-choice").forEach((item) => item.classList.remove("selected"));
    choice.classList.add("selected");
    selectedServerColor = choice.dataset.color;
  });
});

$("#server-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#new-server-name").value.trim();
  if (!name) return;
  state.servers.push({
    id: `server-${Date.now()}`,
    name,
    topic: $("#new-server-topic").value,
    color: selectedServerColor
  });
  saveState();
  renderCustomServers();
  event.currentTarget.reset();
  closeModal($("#server-modal"));
  notify(`${name} sunucusu oluşturuldu`);
});

$("#profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const rawHandle = $("#edit-handle").value.trim().replace(/^@+/, "");
  state.profile = {
    name: $("#edit-name").value.trim(),
    handle: `@${rawHandle}`,
    role: $("#edit-role").value.trim() || "YAAS üyesi"
  };
  saveState();
  applyProfile();
  closeModal($("#profile-modal"));
  notify("Profilin güncellendi");
});

[
  ["reduce-motion-setting", "reduceMotion"],
  ["sound-setting", "sound"],
  ["autoplay-setting", "autoplay"]
].forEach(([id, key]) => {
  $(`#${id}`).addEventListener("change", (event) => {
    state.settings[key] = event.target.checked;
    saveState();
    applySettings();
  });
});

$$(".settings-card .switch").forEach((toggle) => {
  toggle.addEventListener("change", () => notify("Ayar kaydedildi"));
});

$$(".channel").forEach((channel) => {
  channel.addEventListener("click", () => {
    $$(".channel").forEach((item) => item.classList.remove("active"));
    channel.classList.add("active");
    $(".servers").classList.remove("open");
  });
});

$$(".feed-tabs button").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".feed-tabs button").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
  });
});

$(".play-button").addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("playing");
  event.currentTarget.textContent = event.currentTarget.classList.contains("playing") ? "Ⅱ" : "▶";
  notify(event.currentTarget.classList.contains("playing") ? "Video oynatılıyor" : "Video duraklatıldı");
});

$(".mobile-menu").addEventListener("click", () => $(".servers").classList.add("open"));
$(".mobile-close").addEventListener("click", () => $(".servers").classList.remove("open"));
$(".profile-mobile").addEventListener("click", () => $(".profile").classList.add("open"));
$(".profile-close").addEventListener("click", () => $(".profile").classList.remove("open"));

$(".global-search input").addEventListener("input", (event) => {
  const query = event.target.value.toLocaleLowerCase("tr");
  $$(".post").forEach((post) => {
    post.style.display = !query || post.textContent.toLocaleLowerCase("tr").includes(query) ? "block" : "none";
  });
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $(".global-search input").focus();
  }
  if (event.key === "Escape") {
    $$(".modal-layer").forEach(closeModal);
    $(".servers").classList.remove("open");
    $(".profile").classList.remove("open");
  }
});

const voice = {
  roomId: null,
  clientId: null,
  stream: null,
  peers: new Map(),
  participantNames: new Map(),
  pollTimer: null,
  meterTimer: null,
  audioContext: null,
  muted: false,
  deafened: false
};

async function voiceRequest(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`Ses bağlantısı başarısız: ${response.status}`);
  return response.json();
}

async function sendVoiceSignal(to, signal) {
  await voiceRequest("/api/voice/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: voice.roomId, from: voice.clientId, to, signal })
  });
}

function createPeer(peerId, initiator = false) {
  if (voice.peers.has(peerId)) return voice.peers.get(peerId);
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  const peer = { connection, pendingCandidates: [] };
  voice.peers.set(peerId, peer);

  voice.stream.getTracks().forEach((track) => connection.addTrack(track, voice.stream));
  connection.addEventListener("icecandidate", (event) => {
    if (event.candidate) sendVoiceSignal(peerId, { candidate: event.candidate }).catch(() => {});
  });
  connection.addEventListener("track", (event) => {
    let audio = $(`audio[data-peer-id="${CSS.escape(peerId)}"]`, $("#remote-audio"));
    if (!audio) {
      audio = document.createElement("audio");
      audio.dataset.peerId = peerId;
      audio.autoplay = true;
      audio.playsInline = true;
      $("#remote-audio").append(audio);
    }
    audio.srcObject = event.streams[0];
    audio.muted = voice.deafened;
    audio.play().catch(() => {});
  });
  connection.addEventListener("connectionstatechange", () => {
    if (["failed", "closed", "disconnected"].includes(connection.connectionState)) {
      removePeer(peerId);
    }
  });

  if (initiator) {
    connection.createOffer({ offerToReceiveAudio: true })
      .then((offer) => connection.setLocalDescription(offer))
      .then(() => sendVoiceSignal(peerId, { description: connection.localDescription }))
      .catch(() => removePeer(peerId));
  }
  return peer;
}

async function handleVoiceSignal({ from, signal }) {
  const peer = createPeer(from, false);
  const connection = peer.connection;
  if (signal.description) {
    await connection.setRemoteDescription(signal.description);
    while (peer.pendingCandidates.length) {
      await connection.addIceCandidate(peer.pendingCandidates.shift());
    }
    if (signal.description.type === "offer") {
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await sendVoiceSignal(from, { description: connection.localDescription });
    }
  }
  if (signal.candidate) {
    if (connection.remoteDescription) {
      await connection.addIceCandidate(signal.candidate);
    } else {
      peer.pendingCandidates.push(signal.candidate);
    }
  }
}

function removePeer(peerId) {
  const peer = voice.peers.get(peerId);
  peer?.connection.close();
  voice.peers.delete(peerId);
  $(`audio[data-peer-id="${CSS.escape(peerId)}"]`, $("#remote-audio"))?.remove();
}

function renderVoiceParticipants(participants = []) {
  voice.participantNames = new Map(participants.map((person) => [person.id, person.name]));
  const others = participants.filter((person) => person.id !== voice.clientId);
  $("#voice-participants").innerHTML = `
    <div class="voice-person local-person"><span>${escapeHtml(getInitials(state.profile.name))}</span><small>Sen</small></div>
    ${others.map((person) => `<div class="voice-person remote" data-participant-id="${escapeHtml(person.id)}"><span>${escapeHtml(getInitials(person.name))}</span><small>${escapeHtml(person.name.split(" ")[0])}</small></div>`).join("")}`;
  $("#voice-status").textContent = `${participants.length} kişi bağlı · Ses şifreli`;
}

function startVoiceMeter() {
  try {
    voice.audioContext = new AudioContext();
    const analyser = voice.audioContext.createAnalyser();
    analyser.fftSize = 256;
    voice.audioContext.createMediaStreamSource(voice.stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    voice.meterTimer = setInterval(() => {
      analyser.getByteFrequencyData(data);
      const level = data.reduce((sum, value) => sum + value, 0) / data.length;
      $(".local-person")?.classList.toggle("speaking", !voice.muted && level > 18);
    }, 160);
  } catch {
    // Ses göstergesi desteklenmese bile görüşme devam eder.
  }
}

async function pollVoiceRoom() {
  if (!voice.roomId) return;
  try {
    const data = await voiceRequest(`/api/voice/poll?roomId=${encodeURIComponent(voice.roomId)}&clientId=${encodeURIComponent(voice.clientId)}`);
    for (const packet of data.signals) await handleVoiceSignal(packet);
    renderVoiceParticipants(data.participants);
    const activeIds = new Set(data.participants.map((person) => person.id));
    for (const peerId of voice.peers.keys()) {
      if (!activeIds.has(peerId)) removePeer(peerId);
    }
  } catch {
    notify("Sesli oda bağlantısı kesildi");
    leaveVoiceRoom(false);
    return;
  }
  voice.pollTimer = setTimeout(pollVoiceRoom, 700);
}

async function joinVoiceRoom(roomId) {
  if (voice.roomId === roomId) {
    $("#voice-room").hidden = false;
    return;
  }
  if (voice.roomId) await leaveVoiceRoom();
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    notify("Bu tarayıcı sesli görüşmeyi desteklemiyor");
    return;
  }

  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    });
    voice.roomId = roomId;
    voice.clientId = crypto.randomUUID ? crypto.randomUUID() : `voice-${Date.now()}-${Math.random()}`;
    const data = await voiceRequest("/api/voice/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, clientId: voice.clientId, name: state.profile.name })
    });
    $("#voice-room").hidden = false;
    $("#voice-room").classList.remove("minimized");
    renderVoiceParticipants([{ id: voice.clientId, name: state.profile.name }, ...data.peers]);
    data.peers.forEach((peer) => createPeer(peer.id, true));
    startVoiceMeter();
    pollVoiceRoom();
    notify("Sesli kanala katıldın");
  } catch (error) {
    voice.stream?.getTracks().forEach((track) => track.stop());
    voice.stream = null;
    voice.roomId = null;
    notify(error.name === "NotAllowedError" ? "Konuşmak için mikrofon izni gerekli" : "Sesli kanala bağlanılamadı");
  }
}

async function leaveVoiceRoom(sendRequest = true) {
  const payload = { roomId: voice.roomId, clientId: voice.clientId };
  clearTimeout(voice.pollTimer);
  clearInterval(voice.meterTimer);
  voice.audioContext?.close().catch(() => {});
  voice.stream?.getTracks().forEach((track) => track.stop());
  for (const peerId of [...voice.peers.keys()]) removePeer(peerId);
  $("#remote-audio").innerHTML = "";
  $("#voice-room").hidden = true;
  voice.roomId = null;
  voice.clientId = null;
  voice.stream = null;
  voice.muted = false;
  voice.deafened = false;
  $(".mic-control").classList.remove("off");
  $(".sound-control").classList.remove("off");
  if (sendRequest && payload.roomId) {
    fetch("/api/voice/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  }
}

$(".voice-entry").addEventListener("click", () => joinVoiceRoom($(".voice-entry").dataset.room));
$(".mic-control").addEventListener("click", () => {
  voice.muted = !voice.muted;
  voice.stream?.getAudioTracks().forEach((track) => { track.enabled = !voice.muted; });
  $(".mic-control").classList.toggle("off", voice.muted);
  $(".mic-control small").textContent = voice.muted ? "Kapalı" : "Mikrofon";
  $(".mic-control").setAttribute("aria-label", voice.muted ? "Mikrofonu aç" : "Mikrofonu kapat");
});
$(".sound-control").addEventListener("click", () => {
  voice.deafened = !voice.deafened;
  $$("#remote-audio audio").forEach((audio) => { audio.muted = voice.deafened; });
  $(".sound-control").classList.toggle("off", voice.deafened);
  $(".sound-control small").textContent = voice.deafened ? "Kapalı" : "Ses";
  $(".sound-control").setAttribute("aria-label", voice.deafened ? "Sesi aç" : "Sesi kapat");
});
$(".leave-control").addEventListener("click", () => {
  leaveVoiceRoom();
  notify("Sesli kanaldan ayrıldın");
});
$(".voice-minimize").addEventListener("click", () => $("#voice-room").classList.toggle("minimized"));
window.addEventListener("pagehide", () => leaveVoiceRoom());
