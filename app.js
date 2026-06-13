"use strict";

if (location.protocol === "file:") {
  location.replace("http://localhost:4173/");
}

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const PERMISSIONS = {
  "server.view": "Sunucuyu gör",
  "server.manage": "Sunucuyu yönet",
  "members.view": "Üyeleri gör",
  "members.manage": "Üyeleri yönet",
  "roles.manage": "Rolleri yönet",
  "channels.manage": "Kanalları yönet",
  "channel.view": "Kanalları gör",
  "messages.send": "Mesaj gönder",
  "messages.manage": "Mesajları yönet",
  "voice.join": "Ses kanalına katıl",
  "voice.speak": "Ses kanalında konuş",
  "voice.mute_members": "Üyeleri sustur",
  "invites.create": "Davet oluştur"
};

const state = {
  user: null,
  servers: [],
  activeServer: null,
  activeChannel: null
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "İşlem başarısız");
  return data;
}

function notify(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.borderColor = error ? "#7b3f3a" : "";
  toast.style.color = error ? "#ffc0ba" : "";
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function openModal(id) {
  $(`#${id}`).hidden = false;
}

function closeModal(element) {
  element.closest(".modal-layer").hidden = true;
}

function showApp(user) {
  state.user = user;
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#account-name").textContent = user.display_name || user.displayName;
  $("#account-handle").textContent = `@${user.handle}`;
  $("#account-avatar").textContent = initials(user.display_name || user.displayName);
  $("#account-owner-badge").classList.toggle("hidden", !user.is_site_owner);
}

function showAuth() {
  state.user = null;
  $("#app").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
}

function switchAuth(tab) {
  $$("[data-auth-tab]").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
  $("#login-form").classList.toggle("active", tab === "login");
  $("#register-form").classList.toggle("active", tab === "register");
  $("#auth-title").textContent = tab === "login" ? "Tekrar hoş geldin" : "YAAS'a katıl";
  $("#auth-subtitle").textContent = tab === "login"
    ? "Sunucularına kaldığın yerden devam et."
    : "Hesabını oluştur ve ilk sunucunu kur.";
}

async function loadServers(selectId) {
  const data = await api("/api/servers");
  state.servers = data.servers;
  renderServers();
  if (selectId) await openServer(selectId);
}

function renderServers() {
  const list = $("#server-list");
  list.innerHTML = state.servers.map((server) => `
    <button class="server-item ${state.activeServer?.server?.id === server.id ? "active" : ""}" data-server-id="${server.id}" type="button">
      <span class="server-icon">${escapeHtml(initials(server.name))}</span>
      <span><strong>${escapeHtml(server.name)}</strong><small>${server.member_count} üye</small></span>
    </button>`).join("");
  $("#server-list-empty").classList.toggle("hidden", state.servers.length > 0);
  $$(".server-item", list).forEach((button) => button.addEventListener("click", () => openServer(button.dataset.serverId)));
}

async function openServer(serverId) {
  try {
    const data = await api(`/api/servers/${serverId}`);
    state.activeServer = data;
    state.activeChannel = null;
    $("#welcome-view").classList.add("hidden");
    $("#server-view").classList.remove("hidden");
    $("#active-server-name").textContent = data.server.name;
    $("#active-server-description").textContent = data.server.description || `${data.members.length} üye`;
    $(".manage-server-button").classList.toggle("hidden", !data.permissions.includes("roles.manage"));
    $("#add-channel-button").classList.toggle("hidden", !data.permissions.includes("channels.manage"));
    $("#invite-button").classList.toggle("hidden", !data.permissions.includes("invites.create"));
    renderServers();
    renderChannels();
    renderMembers();
    renderRoles();
    showNoChannel();
    $("#server-panel").classList.remove("open");
  } catch (error) {
    notify(error.message, true);
  }
}

function renderChannels() {
  $("#channel-list").innerHTML = state.activeServer.channels.map((channel) => `
    <button class="channel-item" data-channel-id="${channel.id}" type="button">
      <span>${channel.type === "voice" ? "◖" : "#"}</span>${escapeHtml(channel.name)}
      ${channel.is_private ? "<small>⌁</small>" : ""}
    </button>`).join("");
  $$(".channel-item").forEach((button) => button.addEventListener("click", () => {
    const channel = state.activeServer.channels.find((item) => item.id === button.dataset.channelId);
    openChannel(channel);
  }));
}

function renderMembers() {
  const members = state.activeServer.members || [];
  $("#member-empty").classList.toggle("hidden", members.length > 0);
  $("#member-list").innerHTML = members.map((member) => `
    <article class="member-item">
      <span class="avatar">${escapeHtml(initials(member.display_name))}</span>
      <div><span class="member-name-row"><strong>${escapeHtml(member.nickname || member.display_name)}</strong>
      ${member.is_site_owner ? '<i class="site-owner-badge">YAAS SAHİBİ</i>' : ""}</span><small>@${escapeHtml(member.handle)}</small>
      <span>${member.roles.map((role) => `<i class="role-chip" style="color:${escapeHtml(role.color)}">${escapeHtml(role.name)}</i>`).join("")}</span></div>
    </article>`).join("");
}

function renderRoles() {
  const roles = state.activeServer?.roles || [];
  $("#role-list").innerHTML = roles.map((role) => `
    <button class="role-item" data-role-id="${role.id}" type="button">
      <span class="role-dot" style="background:${escapeHtml(role.color)}"></span>${escapeHtml(role.name)}
    </button>`).join("");
  $$(".role-item").forEach((button) => button.addEventListener("click", () => {
    const role = roles.find((item) => item.id === button.dataset.roleId);
    editRole(role);
  }));
}

function showNoChannel() {
  $("#empty-channel").classList.remove("hidden");
  $("#message-view").classList.add("hidden");
  $("#voice-channel-view").classList.add("hidden");
}

async function openChannel(channel) {
  state.activeChannel = channel;
  $$(".channel-item").forEach((button) => button.classList.toggle("active", button.dataset.channelId === channel.id));
  $("#active-channel-name").textContent = channel.name;
  $("#channel-symbol").textContent = channel.type === "voice" ? "◖" : "#";
  $("#channel-kind").textContent = channel.type === "voice" ? "Ses kanalı" : "Yazı kanalı";
  $("#empty-channel").classList.add("hidden");
  $("#message-view").classList.toggle("hidden", channel.type !== "text");
  $("#voice-channel-view").classList.toggle("hidden", channel.type !== "voice");
  $("#server-view").classList.remove("channels-open");
  if (channel.type === "voice") {
    $("#voice-channel-name").textContent = channel.name;
    return;
  }
  await loadMessages();
}

async function loadMessages() {
  try {
    const data = await api(`/api/channels/${state.activeChannel.id}/messages`);
    $("#message-list").innerHTML = data.messages.length
      ? data.messages.map(messageTemplate).join("")
      : `<div class="empty-channel"><span>#</span><strong>İlk mesajı sen gönder</strong><p>Bu kanal henüz boş.</p></div>`;
    $("#message-list").scrollTop = $("#message-list").scrollHeight;
  } catch (error) {
    notify(error.message, true);
  }
}

function messageTemplate(message) {
  const date = new Date(message.created_at || message.createdAt);
  return `<article class="message"><span class="avatar">${escapeHtml(initials(message.author_name || message.authorName))}</span>
    <div class="message-body"><div class="message-meta"><strong>${escapeHtml(message.author_name || message.authorName)}</strong><small>${date.toLocaleString("tr-TR")}</small></div>
    <p>${escapeHtml(message.content)}</p></div></article>`;
}

function buildPermissionGrid(selected = []) {
  $("#permission-grid").innerHTML = Object.entries(PERMISSIONS).map(([key, label]) => `
    <label><input type="checkbox" name="permission" value="${key}" ${selected.includes(key) ? "checked" : ""}>${label}</label>`).join("");
}

function editRole(role) {
  $("#role-id-input").value = role.id;
  $("#role-name-input").value = role.name;
  $("#role-color-input").value = role.color;
  buildPermissionGrid(role.permissions || []);
}

async function start() {
  buildPermissionGrid();
  const providers = await api("/api/auth/providers");
  const enabledProviders = providers.providers || {};
  $$("[data-provider]").forEach((button) => {
    button.disabled = !enabledProviders[button.dataset.provider];
  });
  $("#social-login-note").textContent = enabledProviders.google || enabledProviders.apple
    ? "Sosyal hesabın YAAS hesabın olarak kaydedilir."
    : "Google ve Apple girişi yönetici ayarları tamamlanınca açılacak.";
  const data = await api("/api/me");
  if (!data.user) return showAuth();
  showApp(data.user);
  await loadServers();
}

$$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => switchAuth(button.dataset.authTab)));
$$("[data-open-modal]").forEach((button) => button.addEventListener("click", () => openModal(button.dataset.openModal)));
$$(".modal-close").forEach((button) => button.addEventListener("click", () => closeModal(button)));
$$(".modal-layer").forEach((layer) => layer.addEventListener("click", (event) => {
  if (event.target === layer) layer.hidden = true;
}));
$$("[data-open-panel]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.openPanel}`).classList.add("open")));
$$("[data-close-panel]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closePanel}`).classList.remove("open")));
$$("[data-provider]").forEach((button) => button.addEventListener("click", () => {
  location.href = `/api/auth/oauth/${button.dataset.provider}`;
}));

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value })
    });
    event.currentTarget.reset();
    showApp(data.user);
    await loadServers();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("#register-name").value,
        email: $("#register-email").value,
        password: $("#register-password").value
      })
    });
    event.currentTarget.reset();
    showApp(data.user);
    await loadServers();
  } catch (error) {
    $("#register-error").textContent = error.message;
  }
});

$("#logout-button").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  state.servers = [];
  state.activeServer = null;
  showAuth();
});

$("#create-server-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $(".form-error", event.currentTarget);
  try {
    const data = await api("/api/servers", {
      method: "POST",
      body: JSON.stringify({ name: $("#server-name-input").value, description: $("#server-description-input").value })
    });
    event.currentTarget.reset();
    closeModal(event.currentTarget);
    await loadServers(data.server.id);
    notify("Sunucu oluşturuldu");
  } catch (failure) {
    error.textContent = failure.message;
  }
});

$("#join-server-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const raw = $("#invite-code-input").value.trim();
  const code = raw.split("/").filter(Boolean).pop();
  try {
    const data = await api(`/api/invites/${encodeURIComponent(code)}/join`, { method: "POST", body: "{}" });
    event.currentTarget.reset();
    closeModal(event.currentTarget);
    await loadServers(data.serverId);
    notify("Sunucuya katıldın");
  } catch (error) {
    $(".form-error", event.currentTarget).textContent = error.message;
  }
});

$("#channel-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api(`/api/servers/${state.activeServer.server.id}/channels`, {
      method: "POST",
      body: JSON.stringify({
        name: $("#channel-name-input").value,
        type: $("#channel-type-input").value,
        isPrivate: $("#channel-private-input").checked
      })
    });
    event.currentTarget.reset();
    closeModal(event.currentTarget);
    await openServer(state.activeServer.server.id);
    await openChannel(data.channel);
  } catch (error) {
    $(".form-error", event.currentTarget).textContent = error.message;
  }
});

$("#message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = $("#message-input").value.trim();
  if (!content) return;
  try {
    await api(`/api/channels/${state.activeChannel.id}/messages`, { method: "POST", body: JSON.stringify({ content }) });
    $("#message-input").value = "";
    await loadMessages();
  } catch (error) {
    notify(error.message, true);
  }
});

$("#invite-button").addEventListener("click", async () => {
  try {
    const data = await api(`/api/servers/${state.activeServer.server.id}/invites`, {
      method: "POST",
      body: JSON.stringify({ expiresInHours: 168 })
    });
    await navigator.clipboard.writeText(data.invite.url).catch(() => {});
    notify(`Davet hazır: ${data.invite.code}`);
  } catch (error) {
    notify(error.message, true);
  }
});

$("#new-role-button").addEventListener("click", () => {
  $("#role-form").reset();
  $("#role-id-input").value = "";
  buildPermissionGrid();
});

$("#role-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const serverId = state.activeServer.server.id;
  const roleId = $("#role-id-input").value;
  const payload = {
    name: $("#role-name-input").value,
    color: $("#role-color-input").value,
    permissions: $$("input[name=permission]:checked").map((input) => input.value)
  };
  try {
    await api(roleId ? `/api/servers/${serverId}/roles/${roleId}` : `/api/servers/${serverId}/roles`, {
      method: roleId ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    await openServer(serverId);
    openModal("manage-server-modal");
    notify("Rol kaydedildi");
  } catch (error) {
    $(".form-error", event.currentTarget).textContent = error.message;
  }
});

$("#join-voice-button").addEventListener("click", () => {
  notify("Sunucu izinlerine bağlı ses bağlantısı sıradaki 1.1 adımında etkinleşecek.");
});

$$("[data-mobile-view=channels]").forEach((button) => button.addEventListener("click", () => {
  $("#server-view").classList.toggle("channels-open");
}));

start().catch((error) => {
  console.error(error);
  notify("1.1 veritabanı bağlantısı bekleniyor", true);
  showAuth();
});
