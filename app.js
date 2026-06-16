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
  activeChannel: null,
  friends: { friends: [], incoming: [], outgoing: [] },
  activeDm: null,
  voice: {
    roomId: null,
    clientId: null,
    stream: null,
    videoStream: null,
    videoMode: null,
    peers: new Map(),
    remoteVideoTracks: new Map(),
    pollTimer: null,
    pollFailures: 0,
    muted: false,
    deafened: false
  }
};

const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

async function loadVoiceConfiguration() {
  const data = await voiceApi("config");
  if (Array.isArray(data.iceServers) && data.iceServers.length) {
    RTC_CONFIGURATION.iceServers = data.iceServers;
  }
}

function inviteCodeFromLocation() {
  const pathMatch = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/);
  return pathMatch?.[1] || sessionStorage.getItem("yaasPendingInvite") || "";
}

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

function safeColor(value, fallback = "#c9f34b") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function openModal(id) {
  $(`#${id}`).hidden = false;
}

function closeModal(element) {
  element.closest(".modal-layer").hidden = true;
}

function selectServerTemplate(template) {
  $("#server-template-input").value = template;
  $$("[data-server-template]").forEach((button) => {
    button.classList.toggle("active", button.dataset.serverTemplate === template);
  });
}

function switchSettingsTab(tab) {
  $$("[data-settings-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsTab === tab);
  });
  $$("[data-settings-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
  });
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
      <span class="server-icon" style="background:${safeColor(server.icon_color)}">${escapeHtml(initials(server.name))}</span>
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
    const canOpenSettings = ["server.manage", "roles.manage", "members.view", "invites.create"]
      .some((permission) => data.permissions.includes(permission));
    $(".manage-server-button").classList.toggle("hidden", !canOpenSettings);
    $("#add-channel-button").classList.toggle("hidden", !data.permissions.includes("channels.manage"));
    $("#add-category-button").classList.toggle("hidden", !data.permissions.includes("channels.manage"));
    $("#invite-button").classList.toggle("hidden", !data.permissions.includes("invites.create"));
    $("#server-danger-zone").classList.toggle("hidden", data.server.owner_id !== state.user.id);
    $("#leave-server-zone").classList.toggle("hidden", data.server.owner_id === state.user.id);
    $("#settings-server-name").textContent = `${data.server.name} ayarları`;
    $("#settings-server-name-input").value = data.server.name;
    $("#settings-server-description-input").value = data.server.description || "";
    $("#settings-server-color-input").value = /^#[0-9a-f]{6}$/i.test(data.server.icon_color || "")
      ? data.server.icon_color
      : "#c9f34b";
    $('[data-settings-tab="overview"]').classList.toggle("hidden", !data.permissions.includes("server.manage"));
    $('[data-settings-tab="roles"]').classList.toggle("hidden", !data.permissions.includes("roles.manage"));
    $('[data-settings-tab="members"]').classList.toggle("hidden", !data.permissions.includes("members.view"));
    $('[data-settings-tab="invites"]').classList.toggle("hidden", !data.permissions.includes("invites.create"));
    $("#channel-category-input").innerHTML = '<option value="">Kategorisiz</option>'
      + (data.categories || []).map((category) =>
        `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
    $("#channel-settings-category").innerHTML = $("#channel-category-input").innerHTML;
    roleAccessList($("#channel-create-role-list"), manageableRoles().map((role) => role.id));
    syncCreateRoleAccessVisibility();
    renderServers();
    renderChannels();
    renderMembers();
    renderSettingsMembers();
    renderRoles();
    showNoChannel();
    $("#server-panel").classList.remove("open");
  } catch (error) {
    notify(error.message, true);
  }
}

function renderChannels() {
  const categories = state.activeServer.categories || [];
  const showEmptyCategories = localStorage.getItem("yaas:show-all-channels-setting") !== "false";
  const grouped = categories.map((category) => ({
    ...category,
    channels: state.activeServer.channels.filter((channel) => channel.category_id === category.id)
  })).filter((category) => showEmptyCategories || category.channels.length);
  const uncategorized = state.activeServer.channels.filter((channel) => !channel.category_id);
  const channelButtons = (channels) => channels.map((channel) => `
      <button class="channel-item" data-channel-id="${channel.id}" type="button">
        <span>${channel.type === "voice" ? "◖" : "#"}</span>${escapeHtml(channel.name)}
        ${channel.is_private ? "<small>⌁</small>" : ""}
      </button>`).join("");
  $("#channel-list").innerHTML = grouped.map((category) => `
    <section class="channel-category">
      <div class="channel-category-header">${escapeHtml(category.name)}</div>
      ${channelButtons(category.channels)}
    </section>`).join("")
    + (uncategorized.length ? `<section class="channel-category">${channelButtons(uncategorized)}</section>` : "");
  $$(".channel-item").forEach((button) => button.addEventListener("click", () => {
    const channel = state.activeServer.channels.find((item) => item.id === button.dataset.channelId);
    openChannel(channel);
  }));
}

function renderMembers() {
  const members = state.activeServer.members || [];
  const showContactActions = localStorage.getItem("yaas:server-dm-setting") !== "false";
  $("#member-empty").classList.toggle("hidden", members.length > 0);
  $("#member-list").innerHTML = members.map((member) => `
    <article class="member-item">
      <span class="avatar">${escapeHtml(initials(member.display_name))}</span>
      <div><span class="member-name-row"><strong>${escapeHtml(member.nickname || member.display_name)}</strong>
      ${member.is_site_owner ? '<i class="site-owner-badge">YAAS SAHİBİ</i>' : ""}</span><small>@${escapeHtml(member.handle)}</small>
      <span>${member.roles.map((role) => `<i class="role-chip" style="color:${escapeHtml(role.color)}">${escapeHtml(role.name)}</i>`).join("")}</span>
      ${showContactActions && member.id !== state.user.id ? `<span class="member-actions"><button class="secondary add-friend-button" data-handle="${escapeHtml(member.handle)}" type="button">Arkadaş ekle</button></span>` : ""}
      </div>
    </article>`).join("");
  $$(".add-friend-button").forEach((button) => button.addEventListener("click", () => {
    sendFriendRequest(button.dataset.handle).catch((error) => notify(error.message, true));
  }));
}

function manageableRoles() {
  return (state.activeServer?.roles || []).filter((role) => role.name !== "Owner");
}

function roleAccessList(container, selectedRoleIds = []) {
  const selected = new Set(selectedRoleIds || []);
  const roles = manageableRoles();
  container.innerHTML = roles.length
    ? `<strong>Bu kanalı görebilecek roller</strong>${roles.map((role) => `
      <label class="role-access-row">
        <input type="checkbox" value="${role.id}" ${selected.has(role.id) ? "checked" : ""}>
        <span class="role-dot" style="background:${escapeHtml(role.color)}"></span>
        ${escapeHtml(role.name)}
      </label>`).join("")}`
    : '<small class="empty-list">Özel kanal için önce rol oluşturmalısın.</small>';
}

function selectedRoleAccess(container) {
  return $$("input:checked", container).map((input) => input.value);
}

function syncCreateRoleAccessVisibility() {
  $("#channel-create-role-list").classList.toggle("hidden", !$("#channel-private-input").checked);
}

function renderSettingsMembers() {
  const members = state.activeServer?.members || [];
  const canManageMembers = state.activeServer?.permissions?.includes("members.manage");
  const roles = manageableRoles();
  $("#settings-member-list").innerHTML = members.length
    ? members.map((member) => `
      <article class="settings-member-row">
        <span class="avatar">${escapeHtml(initials(member.display_name))}</span>
        <div>
          <strong>${escapeHtml(member.nickname || member.display_name)}</strong>
          <small>@${escapeHtml(member.handle)}</small>
        </div>
        <span class="settings-member-roles">${member.roles.map((role) =>
          `<i style="color:${escapeHtml(role.color)}">${escapeHtml(role.name)}${canManageMembers && role.name !== "Owner" ? `<button data-remove-role="${role.id}" data-member-id="${member.id}" type="button">×</button>` : ""}</i>`).join("")}</span>
        ${canManageMembers ? `<div class="member-role-tools">
          <select data-role-select="${member.id}">
            <option value="">Rol ver</option>
            ${roles.filter((role) => !member.roles.some((item) => item.id === role.id)).map((role) =>
              `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join("")}
          </select>
          <button class="secondary assign-role-button" data-member-id="${member.id}" type="button">Ekle</button>
        </div>` : ""}
      </article>`).join("")
    : '<div class="empty-list">Bu sunucuda henüz üye yok.</div>';
  $$(".assign-role-button").forEach((button) => button.addEventListener("click", () => {
    const roleId = $(`[data-role-select="${button.dataset.memberId}"]`).value;
    if (!roleId) return notify("Önce bir rol seç", true);
    assignMemberRole(button.dataset.memberId, roleId);
  }));
  $$("[data-remove-role]").forEach((button) => button.addEventListener("click", () => {
    removeMemberRole(button.dataset.memberId, button.dataset.removeRole);
  }));
}

async function assignMemberRole(memberId, roleId) {
  try {
    await api(`/api/servers/${state.activeServer.server.id}/members/${memberId}/roles/${roleId}`, {
      method: "PUT",
      body: "{}"
    });
    await openServer(state.activeServer.server.id);
    openModal("manage-server-modal");
    switchSettingsTab("members");
    notify("Rol verildi");
  } catch (error) {
    notify(error.message, true);
  }
}

async function removeMemberRole(memberId, roleId) {
  try {
    await api(`/api/servers/${state.activeServer.server.id}/members/${memberId}/roles/${roleId}`, {
      method: "DELETE",
      body: "{}"
    });
    await openServer(state.activeServer.server.id);
    openModal("manage-server-modal");
    switchSettingsTab("members");
    notify("Rol kaldırıldı");
  } catch (error) {
    notify(error.message, true);
  }
}

function friendRow(person, actions = "") {
  return `<div class="friend-row">
    <span class="avatar">${escapeHtml(initials(person.display_name))}</span>
    <div><strong>${escapeHtml(person.display_name)}</strong><small>@${escapeHtml(person.handle)}</small></div>
    <span class="friend-actions">${actions}</span>
  </div>`;
}

async function loadFriends() {
  state.friends = await api("/api/friends");
  $("#incoming-friend-list").innerHTML = state.friends.incoming.length
    ? state.friends.incoming.map((person) => friendRow(person,
      `<button class="primary accept-friend-button" data-user-id="${person.id}" type="button">Kabul</button>
       <button class="secondary reject-friend-button" data-user-id="${person.id}" type="button">Sil</button>`)).join("")
    : '<small class="empty-list">İstek yok</small>';
  $("#friend-list").innerHTML = state.friends.friends.length
    ? state.friends.friends.map((person) => friendRow(person,
      `<button class="primary open-dm-button" data-user-id="${person.id}" type="button">Mesaj</button>`)).join("")
    : '<small class="empty-list">Henüz arkadaşın yok</small>';
  $("#outgoing-friend-list").innerHTML = state.friends.outgoing.length
    ? state.friends.outgoing.map((person) => friendRow(person, "<small>Bekliyor</small>")).join("")
    : '<small class="empty-list">Gönderilen istek yok</small>';

  $$(".accept-friend-button").forEach((button) => button.addEventListener("click", () =>
    answerFriendRequest(button.dataset.userId, "accept")));
  $$(".reject-friend-button").forEach((button) => button.addEventListener("click", () =>
    answerFriendRequest(button.dataset.userId, "reject")));
  $$(".open-dm-button").forEach((button) => button.addEventListener("click", () => {
    openDm(state.friends.friends.find((item) => item.id === button.dataset.userId));
  }));
}

async function sendFriendRequest(handle) {
  const data = await api("/api/friends/requests", {
    method: "POST",
    body: JSON.stringify({ handle })
  });
  await loadFriends();
  notify(data.accepted ? "Arkadaşlık kabul edildi" : "Arkadaşlık isteği gönderildi");
}

async function answerFriendRequest(userId, action) {
  await api(`/api/friends/requests/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ action })
  });
  await loadFriends();
  notify(action === "accept" ? "Arkadaşlık isteği kabul edildi" : "İstek silindi");
}

async function openDm(friend) {
  if (!friend) return;
  state.activeDm = friend;
  $("#dm-empty").classList.add("hidden");
  $("#dm-view").classList.remove("hidden");
  $("#dm-avatar").textContent = initials(friend.display_name);
  $("#dm-name").textContent = friend.display_name;
  $("#dm-handle").textContent = `@${friend.handle}`;
  await loadDmMessages();
}

async function loadDmMessages() {
  if (!state.activeDm) return;
  const data = await api(`/api/dms/${state.activeDm.id}`);
  $("#dm-message-list").innerHTML = data.messages.length
    ? data.messages.map((message) => `<div class="dm-message ${message.sender_id === state.user.id ? "mine" : ""}">
        ${escapeHtml(message.content)}
        <small>${new Date(message.created_at).toLocaleString("tr-TR")}</small>
      </div>`).join("")
    : '<div class="dm-empty">İlk özel mesajı gönder.</div>';
  $("#dm-message-list").scrollTop = $("#dm-message-list").scrollHeight;
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
  if (state.voice.roomId && state.voice.roomId !== channel.id) await leaveVoice();
  state.activeChannel = channel;
  $$(".channel-item").forEach((button) => button.classList.toggle("active", button.dataset.channelId === channel.id));
  $("#active-channel-name").textContent = channel.name;
  $("#channel-symbol").textContent = channel.type === "voice" ? "◖" : "#";
  $("#channel-kind").textContent = channel.type === "voice" ? "Ses kanalı" : "Yazı kanalı";
  $("#channel-settings-button").classList.toggle("hidden", !state.activeServer.permissions.includes("channels.manage"));
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

function openChannelSettings() {
  const channel = state.activeChannel;
  if (!channel) return;
  $("#channel-settings-id").value = channel.id;
  $("#channel-settings-name").value = channel.name;
  $("#channel-settings-category").value = channel.category_id || "";
  $("#channel-settings-private").checked = Boolean(channel.is_private);
  roleAccessList($("#channel-settings-role-list"), channel.allowed_role_ids || []);
  $("#channel-settings-voice-note").classList.toggle("hidden", channel.type !== "voice");
  openModal("channel-settings-modal");
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

async function voiceApi(path, options = {}) {
  return api(`/api/voice/${path}`, options);
}

function renderVoiceParticipants(participants = []) {
  const list = $("#voice-participants");
  list.innerHTML = participants.map((participant) =>
    `<span class="voice-person">${escapeHtml(participant.name)}${participant.id === state.voice.clientId ? " (sen)" : ""}</span>`
  ).join("");
  list.classList.toggle("hidden", participants.length === 0);
}

async function sendVoiceSignal(to, signal) {
  await voiceApi("signal", {
    method: "POST",
    body: JSON.stringify({ roomId: state.voice.roomId, from: state.voice.clientId, to, signal })
  });
}

function attachRemoteAudio(peerId, stream) {
  let audio = document.getElementById(`voice-audio-${peerId}`);
  if (!audio) {
    audio = document.createElement("audio");
    audio.id = `voice-audio-${peerId}`;
    audio.autoplay = true;
    audio.playsInline = true;
    $("#remote-audio-container").append(audio);
  }
  audio.srcObject = stream;
  audio.muted = state.voice.deafened;
}

function attachRemoteVideo(peerId, track) {
  let tile = document.getElementById(`voice-video-tile-${peerId}`);
  if (!tile) {
    tile = document.createElement("figure");
    tile.id = `voice-video-tile-${peerId}`;
    tile.className = "voice-video-tile";
    tile.innerHTML = `<video autoplay muted playsinline></video><figcaption>Katılımcı</figcaption>`;
    $("#voice-video-grid").append(tile);
  }
  const video = $("video", tile);
  video.srcObject = new MediaStream([track]);
  state.voice.remoteVideoTracks.set(peerId, track);
  tile.classList.toggle("hidden", track.muted);
  updateVideoGridVisibility();
  track.onunmute = () => {
    tile.classList.remove("hidden");
    updateVideoGridVisibility();
  };
  track.onmute = () => {
    tile.classList.add("hidden");
    updateVideoGridVisibility();
  };
  track.onended = () => {
    state.voice.remoteVideoTracks.delete(peerId);
    tile.remove();
    updateVideoGridVisibility();
  };
}

function updateVideoGridVisibility() {
  const hasVisibleTile = $$(".voice-video-tile", $("#voice-video-grid"))
    .some((tile) => !tile.classList.contains("hidden"));
  $("#voice-video-grid").classList.toggle("hidden", !hasVisibleTile);
}

async function negotiateVoicePeer(peerId, connection) {
  if (connection.signalingState !== "stable") return;
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  await sendVoiceSignal(peerId, offer);
}

function videoSender(connection) {
  return connection.getTransceivers()
    .find((item) => item.receiver.track?.kind === "video")?.sender || null;
}

function removeVoicePeer(peerId) {
  const connection = state.voice.peers.get(peerId);
  state.voice.peers.delete(peerId);
  connection?.close();
  state.voice.remoteVideoTracks.delete(peerId);
  document.getElementById(`voice-audio-${peerId}`)?.remove();
  document.getElementById(`voice-video-tile-${peerId}`)?.remove();
  updateVideoGridVisibility();
}

function createVoicePeer(peerId, initiator) {
  if (state.voice.peers.has(peerId)) return state.voice.peers.get(peerId);
  const connection = new RTCPeerConnection(RTC_CONFIGURATION);
  state.voice.stream.getAudioTracks().forEach((track) => connection.addTrack(track, state.voice.stream));
  connection.addTransceiver("video", { direction: "sendrecv" });
  connection.onicecandidate = ({ candidate }) => {
    if (candidate) sendVoiceSignal(peerId, { type: "ice", candidate }).catch(() => {});
  };
  connection.ontrack = ({ track, streams }) => {
    if (track.kind === "video") attachRemoteVideo(peerId, track);
    else attachRemoteAudio(peerId, streams[0] || new MediaStream([track]));
  };
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === "disconnected") {
      clearTimeout(connection.disconnectTimer);
      connection.disconnectTimer = setTimeout(() => {
        if (connection.connectionState === "disconnected") removeVoicePeer(peerId);
      }, 8000);
    } else {
      clearTimeout(connection.disconnectTimer);
      if (["failed", "closed"].includes(connection.connectionState)) removeVoicePeer(peerId);
    }
  };
  state.voice.peers.set(peerId, connection);
  if (initiator) negotiateVoicePeer(peerId, connection).catch(() => {});
  return connection;
}

async function handleVoiceSignal(from, signal) {
  if (signal.type === "video-stop") {
    document.getElementById(`voice-video-tile-${from}`)?.classList.add("hidden");
    updateVideoGridVisibility();
    return;
  }
  if (signal.type === "video-start") {
    document.getElementById(`voice-video-tile-${from}`)?.classList.remove("hidden");
    updateVideoGridVisibility();
    return;
  }
  const connection = createVoicePeer(from, false);
  if (signal.type === "offer") {
    await connection.setRemoteDescription(signal);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await sendVoiceSignal(from, answer);
  } else if (signal.type === "answer") {
    await connection.setRemoteDescription(signal);
  } else if (signal.type === "ice" && signal.candidate) {
    await connection.addIceCandidate(signal.candidate).catch(() => {});
  }
}

async function pollVoice() {
  if (!state.voice.roomId) return;
  try {
    const data = await voiceApi(
      `poll?roomId=${encodeURIComponent(state.voice.roomId)}&clientId=${encodeURIComponent(state.voice.clientId)}`
    );
    renderVoiceParticipants(data.participants || []);
    state.voice.pollFailures = 0;
    $("#voice-status").textContent = state.voice.muted ? "Mikrofon kapalı" : "Bağlandı";
    for (const item of data.signals || []) {
      await handleVoiceSignal(item.from, item.signal).catch(() => {});
    }
    state.voice.pollTimer = setTimeout(pollVoice, 900);
  } catch {
    state.voice.pollFailures += 1;
    if (state.voice.pollFailures >= 5) {
      await leaveVoice(false);
      notify("Ses bağlantısı kesildi", true);
      return;
    }
    $("#voice-status").textContent = "Bağlantı yenileniyor...";
    state.voice.pollTimer = setTimeout(pollVoice, 1500);
  }
}

async function joinVoice() {
  if (!state.activeChannel || state.activeChannel.type !== "voice" || state.voice.roomId) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    return notify("Bu tarayıcı sesli görüşmeyi desteklemiyor", true);
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    state.voice.roomId = state.activeChannel.id;
    state.voice.clientId = crypto.randomUUID();
    state.voice.stream = stream;
    state.voice.pollFailures = 0;
    const data = await voiceApi("join", {
      method: "POST",
      body: JSON.stringify({
        roomId: state.voice.roomId,
        clientId: state.voice.clientId,
        name: state.user.display_name || state.user.displayName
      })
    });
    if (!data.canSpeak) {
      stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      state.voice.muted = true;
    }
    $("#join-voice-button").classList.add("hidden");
    $("#mute-voice-button").classList.toggle("hidden", !data.canSpeak);
    $("#deafen-voice-button").classList.remove("hidden");
    $("#camera-voice-button").classList.remove("hidden");
    $("#screen-voice-button").classList.remove("hidden");
    $("#leave-voice-button").classList.remove("hidden");
    $("#voice-status").textContent = data.canSpeak ? "Bağlandı" : "Dinleyici olarak bağlandı";
    renderVoiceParticipants([{ id: state.voice.clientId, name: state.user.display_name || state.user.displayName }]);
    for (const peer of data.peers || []) createVoicePeer(peer.id, true);
    pollVoice();
  } catch (error) {
    state.voice.stream?.getTracks().forEach((track) => track.stop());
    Object.assign(state.voice, { roomId: null, clientId: null, stream: null });
    notify(error.name === "NotAllowedError" ? "Mikrofon izni verilmedi" : error.message, true);
  }
}

async function setOutgoingVideo(track, stream, mode) {
  const previousStream = state.voice.videoStream;
  state.voice.videoStream = stream;
  state.voice.videoMode = mode;
  for (const [peerId, connection] of state.voice.peers) {
    const sender = videoSender(connection);
    if (sender) await sender.replaceTrack(track);
    await sendVoiceSignal(peerId, { type: "video-start", mode }).catch(() => {});
  }
  previousStream?.getTracks().forEach((item) => {
    item.onended = null;
    if (item !== track) item.stop();
  });
  $("#local-video").srcObject = stream;
  $("#local-video-tile").classList.remove("hidden");
  $("#voice-video-grid").classList.remove("hidden");
  $("#camera-voice-button").textContent = mode === "camera" ? "Kamerayı kapat" : "Kamerayı aç";
  $("#screen-voice-button").textContent = mode === "screen" ? "Paylaşımı durdur" : "Ekranı paylaş";
  track.onended = () => {
    if (state.voice.videoStream === stream) stopOutgoingVideo();
  };
}

async function stopOutgoingVideo() {
  const stream = state.voice.videoStream;
  if (!stream) return;
  state.voice.videoStream = null;
  state.voice.videoMode = null;
  for (const [peerId, connection] of state.voice.peers) {
    const sender = videoSender(connection);
    if (sender) await sender.replaceTrack(null);
    await sendVoiceSignal(peerId, { type: "video-stop" }).catch(() => {});
  }
  stream?.getTracks().forEach((track) => track.stop());
  $("#local-video").srcObject = null;
  $("#local-video-tile").classList.add("hidden");
  $("#camera-voice-button").textContent = "Kamerayı aç";
  $("#screen-voice-button").textContent = "Ekranı paylaş";
  updateVideoGridVisibility();
}

async function toggleCamera() {
  if (!state.voice.roomId) return;
  if (state.voice.videoMode === "camera") return stopOutgoingVideo();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false
    });
    await setOutgoingVideo(stream.getVideoTracks()[0], stream, "camera");
  } catch (error) {
    notify(error.name === "NotAllowedError" ? "Kamera izni verilmedi" : "Kamera açılamadı", true);
  }
}

async function toggleScreenShare() {
  if (!state.voice.roomId) return;
  if (state.voice.videoMode === "screen") return stopOutgoingVideo();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return notify("Bu tarayıcı ekran paylaşımını desteklemiyor", true);
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: false
    });
    await setOutgoingVideo(stream.getVideoTracks()[0], stream, "screen");
  } catch (error) {
    if (error.name !== "NotAllowedError") notify("Ekran paylaşımı başlatılamadı", true);
  }
}

async function leaveVoice(notifyServer = true) {
  clearTimeout(state.voice.pollTimer);
  await stopOutgoingVideo();
  if (notifyServer && state.voice.roomId && state.voice.clientId) {
    await voiceApi("leave", {
      method: "POST",
      body: JSON.stringify({ roomId: state.voice.roomId, clientId: state.voice.clientId })
    }).catch(() => {});
  }
  state.voice.peers.forEach((connection) => connection.close());
  state.voice.peers.clear();
  state.voice.stream?.getTracks().forEach((track) => track.stop());
  $("#remote-audio-container").replaceChildren();
  renderVoiceParticipants([]);
  $("#join-voice-button").classList.remove("hidden");
  $("#mute-voice-button").classList.add("hidden");
  $("#deafen-voice-button").classList.add("hidden");
  $("#camera-voice-button").classList.add("hidden");
  $("#screen-voice-button").classList.add("hidden");
  $("#leave-voice-button").classList.add("hidden");
  $("#voice-status").textContent = "Bağlı değil";
  $("#mute-voice-button").textContent = "Mikrofonu kapat";
  $("#deafen-voice-button").textContent = "Sesi kapat";
  Object.assign(state.voice, {
    roomId: null,
    clientId: null,
    stream: null,
    videoStream: null,
    videoMode: null,
    remoteVideoTracks: new Map(),
    pollTimer: null,
    pollFailures: 0,
    muted: false,
    deafened: false
  });
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

async function joinPendingInvite() {
  const code = inviteCodeFromLocation();
  if (!code || !state.user) return false;
  const data = await api(`/api/invites/${encodeURIComponent(code)}/join`, {
    method: "POST",
    body: "{}"
  });
  sessionStorage.removeItem("yaasPendingInvite");
  history.replaceState({}, "", "/");
  await loadServers(data.serverId);
  notify("Sunucuya katıldın");
  return true;
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
  if (!data.user) {
    const inviteCode = inviteCodeFromLocation();
    if (inviteCode) {
      sessionStorage.setItem("yaasPendingInvite", inviteCode);
      $("#auth-subtitle").textContent = "Davet edilen sunucuya katılmak için giriş yap veya hesap oluştur.";
    }
    return showAuth();
  }
  showApp(data.user);
  await loadVoiceConfiguration().catch(() => {});
  if (!(await joinPendingInvite())) await loadServers();
}

$$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => switchAuth(button.dataset.authTab)));
$$("[data-open-modal]").forEach((button) => button.addEventListener("click", () => openModal(button.dataset.openModal)));
$$("[data-server-template]").forEach((button) => button.addEventListener("click", () => {
  selectServerTemplate(button.dataset.serverTemplate);
}));
$$("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => {
  switchSettingsTab(button.dataset.settingsTab);
}));
$(".manage-server-button").addEventListener("click", () => {
  const firstTab = $$("[data-settings-tab]").find((button) => !button.classList.contains("hidden"));
  switchSettingsTab(firstTab?.dataset.settingsTab || "preferences");
});
$("#builder-open-join").addEventListener("click", () => {
  closeModal($("#builder-open-join"));
  openModal("join-server-modal");
});
$("#channel-settings-button").addEventListener("click", openChannelSettings);
$("#channel-private-input").addEventListener("change", syncCreateRoleAccessVisibility);
$$(".modal-close").forEach((button) => button.addEventListener("click", () => closeModal(button)));
$$(".modal-layer").forEach((layer) => layer.addEventListener("click", (event) => {
  if (event.target === layer) layer.hidden = true;
}));
$$("[data-open-panel]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.openPanel}`).classList.add("open")));
$$("[data-close-panel]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closePanel}`).classList.remove("open")));
$$("[data-provider]").forEach((button) => button.addEventListener("click", () => {
  const inviteCode = inviteCodeFromLocation();
  if (inviteCode) sessionStorage.setItem("yaasPendingInvite", inviteCode);
  location.href = `/api/auth/oauth/${button.dataset.provider}`;
}));

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value })
    });
    form.reset();
    showApp(data.user);
    if (!(await joinPendingInvite())) await loadServers();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("#register-name").value,
        email: $("#register-email").value,
        password: $("#register-password").value
      })
    });
    form.reset();
    showApp(data.user);
    if (!(await joinPendingInvite())) await loadServers();
  } catch (error) {
    $("#register-error").textContent = error.message;
  }
});

$("#logout-button").addEventListener("click", async () => {
  await leaveVoice();
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  state.servers = [];
  state.activeServer = null;
  state.friends = { friends: [], incoming: [], outgoing: [] };
  state.activeDm = null;
  showAuth();
});

$("#friends-button").addEventListener("click", async () => {
  try {
    await loadFriends();
    openModal("friends-modal");
    $("#server-panel").classList.remove("open");
  } catch (error) {
    notify(error.message, true);
  }
});

$("#friend-request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $(".form-error", form);
  error.textContent = "";
  try {
    await sendFriendRequest($("#friend-handle-input").value);
    form.reset();
  } catch (failure) {
    error.textContent = failure.message;
  }
});

$("#dm-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = $("#dm-message-input").value.trim();
  if (!content || !state.activeDm) return;
  try {
    await api(`/api/dms/${state.activeDm.id}`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    $("#dm-message-input").value = "";
    await loadDmMessages();
  } catch (error) {
    notify(error.message, true);
  }
});

$("#create-server-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $(".form-error", form);
  error.textContent = "";
  try {
    const data = await api("/api/servers", {
      method: "POST",
      body: JSON.stringify({
        name: $("#server-name-input").value,
        description: $("#server-description-input").value,
        template: $("#server-template-input").value
      })
    });
    form.reset();
    selectServerTemplate("custom");
    closeModal(form);
    await loadServers(data.server.id);
    notify("Sunucu oluşturuldu");
  } catch (failure) {
    error.textContent = failure.message;
  }
});

$("#join-server-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formError = $(".form-error", form);
  formError.textContent = "";
  const raw = $("#invite-code-input").value.trim();
  const code = raw.split("/").filter(Boolean).pop();
  try {
    const data = await api(`/api/invites/${encodeURIComponent(code)}/join`, { method: "POST", body: "{}" });
    form.reset();
    closeModal(form);
    await loadServers(data.serverId);
    notify("Sunucuya katıldın");
  } catch (error) {
    formError.textContent = error.message;
  }
});

$("#channel-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formError = $(".form-error", form);
  formError.textContent = "";
  try {
    const data = await api(`/api/servers/${state.activeServer.server.id}/channels`, {
      method: "POST",
      body: JSON.stringify({
        name: $("#channel-name-input").value,
        type: $("#channel-type-input").value,
        categoryId: $("#channel-category-input").value || null,
        isPrivate: $("#channel-private-input").checked,
        allowedRoleIds: $("#channel-private-input").checked ? selectedRoleAccess($("#channel-create-role-list")) : []
      })
    });
    form.reset();
    closeModal(form);
    await openServer(state.activeServer.server.id);
    await openChannel(data.channel);
  } catch (error) {
    formError.textContent = error.message;
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

$("#channel-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formError = $(".form-error", form);
  formError.textContent = "";
  const channelId = $("#channel-settings-id").value;
  const serverId = state.activeServer.server.id;
  const isPrivate = $("#channel-settings-private").checked;
  try {
    await api(`/api/servers/${serverId}/channels/${channelId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: $("#channel-settings-name").value,
        categoryId: $("#channel-settings-category").value || null,
        isPrivate,
        allowedRoleIds: isPrivate ? selectedRoleAccess($("#channel-settings-role-list")) : []
      })
    });
    closeModal(form);
    await openServer(serverId);
    const updated = state.activeServer.channels.find((channel) => channel.id === channelId);
    if (updated) await openChannel(updated);
    notify("Kanal ayarları kaydedildi");
  } catch (error) {
    formError.textContent = error.message;
  }
});

$("#delete-channel-button").addEventListener("click", async () => {
  const channelId = $("#channel-settings-id").value;
  const channelName = $("#channel-settings-name").value;
  const serverId = state.activeServer.server.id;
  if (!confirm(`"${channelName}" kanalını silmek istediğine emin misin?`)) return;
  try {
    await api(`/api/servers/${serverId}/channels/${channelId}`, { method: "DELETE", body: "{}" });
    closeModal($("#delete-channel-button"));
    state.activeChannel = null;
    await openServer(serverId);
    notify("Kanal silindi");
  } catch (error) {
    notify(error.message, true);
  }
});

async function createActiveServerInvite() {
  try {
    const data = await api(`/api/servers/${state.activeServer.server.id}/invites`, {
      method: "POST",
      body: JSON.stringify({ expiresInHours: 168 })
    });
    $("#invite-link-output").value = data.invite.url;
    openModal("invite-modal");
  } catch (error) {
    notify(error.message, true);
  }
}

$("#invite-button").addEventListener("click", createActiveServerInvite);
$("#settings-create-invite").addEventListener("click", createActiveServerInvite);

$("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formError = $(".form-error", form);
  formError.textContent = "";
  try {
    await api(`/api/servers/${state.activeServer.server.id}/categories`, {
      method: "POST",
      body: JSON.stringify({ name: $("#category-name-input").value })
    });
    form.reset();
    closeModal(form);
    await openServer(state.activeServer.server.id);
    notify("Kategori oluşturuldu");
  } catch (error) {
    formError.textContent = error.message;
  }
});

$("#copy-invite-button").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#invite-link-output").value);
  notify("Davet bağlantısı kopyalandı");
});

$("#share-invite-button").addEventListener("click", async () => {
  const url = $("#invite-link-output").value;
  if (navigator.share) {
    await navigator.share({ title: "YAAS sunucu daveti", text: "YAAS sunucuma katıl", url });
  } else {
    await navigator.clipboard.writeText(url);
    notify("Paylaşım desteklenmiyor; bağlantı kopyalandı");
  }
});

$("#server-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formError = $(".form-error", form);
  formError.textContent = "";
  const serverId = state.activeServer.server.id;
  try {
    await api(`/api/servers/${serverId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: $("#settings-server-name-input").value,
        description: $("#settings-server-description-input").value,
        iconColor: $("#settings-server-color-input").value
      })
    });
    await openServer(serverId);
    openModal("manage-server-modal");
    switchSettingsTab("overview");
    notify("Sunucu bilgileri güncellendi");
  } catch (error) {
    formError.textContent = error.message;
  }
});

$("#delete-server-button").addEventListener("click", async () => {
  if (!state.activeServer) return;
  const serverName = state.activeServer.server.name;
  if (!confirm(`"${serverName}" sunucusunu kalıcı olarak silmek istediğine emin misin?`)) return;
  try {
    await api(`/api/servers/${state.activeServer.server.id}`, { method: "DELETE", body: "{}" });
    closeModal($("#delete-server-button"));
    state.activeServer = null;
    state.activeChannel = null;
    $("#server-view").classList.add("hidden");
    $("#welcome-view").classList.remove("hidden");
    await loadServers();
    notify("Sunucu silindi");
  } catch (error) {
    notify(error.message, true);
  }
});

$("#leave-server-button").addEventListener("click", async () => {
  if (!state.activeServer) return;
  const serverName = state.activeServer.server.name;
  if (!confirm(`"${serverName}" sunucusundan ayrılmak istediğine emin misin?`)) return;
  try {
    await api(`/api/servers/${state.activeServer.server.id}/members/me`, { method: "DELETE", body: "{}" });
    closeModal($("#leave-server-button"));
    state.activeServer = null;
    state.activeChannel = null;
    $("#server-view").classList.add("hidden");
    $("#welcome-view").classList.remove("hidden");
    await loadServers();
    notify("Sunucudan ayrıldın");
  } catch (error) {
    notify(error.message, true);
  }
});

const preferenceInputs = ["show-all-channels-setting", "server-dm-setting"];
for (const inputId of preferenceInputs) {
  const input = $(`#${inputId}`);
  const saved = localStorage.getItem(`yaas:${inputId}`);
  if (saved !== null) input.checked = saved === "true";
  input.addEventListener("change", () => {
    localStorage.setItem(`yaas:${inputId}`, String(input.checked));
    if (state.activeServer) {
      renderChannels();
      renderMembers();
    }
    notify("Tercih kaydedildi");
  });
}

$("#new-role-button").addEventListener("click", () => {
  $("#role-form").reset();
  $("#role-id-input").value = "";
  buildPermissionGrid();
});

$("#role-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formError = $(".form-error", form);
  formError.textContent = "";
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
    formError.textContent = error.message;
  }
});

$("#join-voice-button").addEventListener("click", joinVoice);
$("#leave-voice-button").addEventListener("click", () => leaveVoice());
$("#mute-voice-button").addEventListener("click", () => {
  state.voice.muted = !state.voice.muted;
  state.voice.stream?.getAudioTracks().forEach((track) => { track.enabled = !state.voice.muted; });
  $("#mute-voice-button").textContent = state.voice.muted ? "Mikrofonu aç" : "Mikrofonu kapat";
  $("#voice-status").textContent = state.voice.muted ? "Mikrofon kapalı" : "Bağlandı";
});
$("#deafen-voice-button").addEventListener("click", () => {
  state.voice.deafened = !state.voice.deafened;
  $$("#remote-audio-container audio").forEach((audio) => { audio.muted = state.voice.deafened; });
  $("#deafen-voice-button").textContent = state.voice.deafened ? "Sesi aç" : "Sesi kapat";
});
$("#camera-voice-button").addEventListener("click", toggleCamera);
$("#screen-voice-button").addEventListener("click", toggleScreenShare);
window.addEventListener("beforeunload", () => {
  if (state.voice.roomId) {
    navigator.sendBeacon("/api/voice/leave", JSON.stringify({
      roomId: state.voice.roomId,
      clientId: state.voice.clientId
    }));
  }
});

$$("[data-mobile-view=channels]").forEach((button) => button.addEventListener("click", () => {
  $("#server-view").classList.toggle("channels-open");
}));

start().catch((error) => {
  console.error(error);
  notify("1.1 veritabanı bağlantısı bekleniyor", true);
  showAuth();
});
