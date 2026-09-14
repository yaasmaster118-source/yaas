"use strict";

function openStudioWindow(draft = {}) {
  if (studioWindowRef && !studioWindowRef.closed) { studioWindowRef.focus(); return; }
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("studio", "1");
  url.searchParams.set("v", UI_VERSION);
  for (const key of ["title", "serverId", "visibility"]) if (draft[key]) url.searchParams.set(key, draft[key]);
  studioWindowRef = window.open("", "yaas-broadcast-studio", "popup,width=1440,height=960,resizable=yes,scrollbars=yes");
  if (studioWindowRef) {
    if (studioWindowRef.location.href === "about:blank") studioWindowRef.location.replace(url.href);
    studioWindowRef.focus();
  }
  if (!studioWindowRef) notify("Studio penceresi engellendi. Bu site için açılır pencerelere izin verip tekrar dene.", true);
}

async function initializeStudioWindow() {
  document.title = "YAAS Studio • Yayın hazırlığı";
  document.body.classList.add("studio-window-mode");
  $("#app").classList.add("hidden");
  let host = document.getElementById("standalone-studio");
  if (!host) { host = document.createElement("div"); host.id = "standalone-studio"; document.body.append(host); }
  if (activeStudio) return;
  const setup = async () => {
    const [servers, config] = await Promise.all([api("/api/servers"), streamRtcApi("config")]);
    if (Array.isArray(config.iceServers) && config.iceServers.length) RTC_CONFIGURATION.iceServers = config.iceServers;
    activeStudio = new YaasStudio({
      start: startStandaloneBroadcast,
      stop: stopStandaloneBroadcast,
      end: async () => { await stopStandaloneBroadcast(); activeStudio?.addEvent("Yayın sonlandırıldı. Yeni yayın hazırlayabilirsin."); },
      exit: async () => { await stopStandaloneBroadcast(); activeStudio?.dispose(); window.close(); },
      notify: (message, error) => { notify(message, error); activeStudio?.addEvent(message); }
    });
    activeStudio.mount(host, "Yayın hazırlığı", "0");
    activeStudio.addPreparationControls(servers.servers || []);
  };
  if (navigator.locks) {
    navigator.locks.request("yaas-studio-owner", { ifAvailable: true }, async lock => {
      if (!lock) { host.textContent = "YAAS Studio başka bir pencerede açık. Yayınını o pencereden yönetebilirsin."; return; }
      try { await setup(); await new Promise(resolve => window.addEventListener("pagehide", resolve, { once: true })); }
      catch (error) { host.textContent = error.message; }
    });
  } else await setup();
}

async function startStandaloneBroadcast(media) {
  const studio = activeStudio;
  const draft = studio.broadcastSettings();
  if (!draft.title) throw new Error("Yayın başlığı yaz.");
  if (draft.visibility === "server" && !draft.serverId) throw new Error("Yayın yapılacak sunucuyu seç.");
  let createdId;
  try {
    const result = await api("/api/streams", { method: "POST", body: JSON.stringify(draft) });
    createdId = result.stream.id;
    state.activeStream = result.stream;
    if (studio.closed) throw new Error("Studio kapandı");
    await joinStreamRtc(result.stream);
    if (studio.closed) throw new Error("Studio kapandı");
    await setStreamBroadcastMedia(media, "screen");
    studio.addEvent("Canlı yayın başladı.");
    document.title = "● CANLI • YAAS Studio";
    studio.setSettingsEnabled(false);
  } catch (error) {
    if (createdId) await api(`/api/streams/${createdId}`, { method: "DELETE" }).catch(() => {});
    await leaveStreamRtc(true, true);
    state.activeStream = null;
    throw error;
  }
}

async function stopStandaloneBroadcast() {
  const id = state.activeStream?.id;
  let endError;
  if (id) {
    try { await api(`/api/streams/${id}`, { method: "DELETE" }); }
    catch (error) { endError = error; }
  }
  await leaveStreamRtc(true, true);
  state.activeStream = null;
  if (activeStudio) {
    activeStudio.live = false;
    activeStudio.participantIds = new Set();
    activeStudio.setSettingsEnabled(true);
    activeStudio.sync();
    activeStudio.addEvent("Yayın kapalı. Hazırlık görüntüsü yalnızca sende.");
    if (endError) activeStudio.addEvent("Sunucuya ulaşılamadı. Görüntü aktarımı durduruldu; yayın kaydı bağlantı zaman aşımında kapanacak.");
    activeStudio.host.querySelector("#studio-viewers").textContent = "0 izleyici";
  }
  document.title = "YAAS Studio • Yayın hazırlığı";
}

function cleanupStandaloneBroadcast() {
  if (state.activeStream?.id) fetch(`/api/streams/${encodeURIComponent(state.activeStream.id)}`, { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {});
  activeStudio?.dispose();
}

function bindLiveChat(host) {
  const form = host.querySelector("#stream-chat-form");
  if (!form) return;
  form.onsubmit = async event => {
    event.preventDefault();
    const input = form.querySelector("input");
    const text = input.value.trim();
    if (!text || !state.activeStream?.id) return notify("Sohbet canlı yayın başladığında açılır.", true);
    const button = form.querySelector("button"); button.disabled = true;
    try {
      await streamRtcApi("chat", { method: "POST", body: JSON.stringify({ streamId: state.activeStream.id, text }) });
      input.value = "";
    } catch (error) { notify(error.message, true); }
    finally { button.disabled = false; }
  };
}

function updateLiveChat(messages) {
  const list = document.getElementById("stream-live-chat");
  if (!list) return;
  const signature = messages.map(message => message.id).join(",");
  if (list.dataset.messages === signature) return;
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.dataset.messages = signature;
  list.replaceChildren();
  for (const message of messages) {
    const row = document.createElement("p");
    const author = document.createElement("strong"); author.textContent = `${message.name}: `;
    row.append(author, document.createTextNode(message.text)); list.append(row);
  }
  if (atEnd) list.scrollTop = list.scrollHeight;
}

YaasStudio.prototype.addEvent = function(message) {
  const list = this.host?.querySelector("#studio-events");
  if (!list) return;
  const row = document.createElement("p");
  row.textContent = `${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} · ${message}`;
  list.prepend(row);
  while (list.children.length > 40) list.lastElementChild.remove();
};

YaasStudio.prototype.receiveParticipants = function(participants) {
  const viewers = participants.filter(person => person.role === "viewer");
  const current = new Set(viewers.map(person => person.id));
  for (const person of viewers) if (!this.participantIds?.has(person.id)) this.addEvent(`${person.name} yayına katıldı.`);
  for (const id of this.participantIds || []) if (!current.has(id)) this.addEvent("Bir izleyici yayından ayrıldı.");
  this.participantIds = current;
  this.host.querySelector("#studio-viewers").textContent = `${viewers.length} izleyici`;
};

YaasStudio.prototype.broadcastSettings = function() {
  const q = selector => this.host.querySelector(selector).value;
  return { title: q("#studio-broadcast-title").trim(), visibility: q("#studio-visibility"), serverId: q("#studio-server") || null };
};
YaasStudio.prototype.setSettingsEnabled = function(enabled) {
  this.host.querySelectorAll(".studio-broadcast-settings input,.studio-broadcast-settings select").forEach(input => { input.disabled = !enabled; });
};

YaasStudio.prototype.addPreparationControls = function(servers) {
  const params = new URLSearchParams(location.search);
  const settings = document.createElement("section"); settings.className = "studio-panel studio-broadcast-settings";
  settings.innerHTML = `<label>Yayın başlığı<input id="studio-broadcast-title" maxlength="80" placeholder="Bugün ne yayınlıyorsun?"></label><label>Kimler izleyebilir?<select id="studio-visibility"><option value="global">Herkese açık</option><option value="friends">Arkadaşlar</option><option value="server">Sunucu</option></select></label><label>Sunucu<select id="studio-server"><option value="">Sunucu seç</option></select></label>`;
  this.host.querySelector(".studio-header").after(settings);
  settings.querySelector("#studio-broadcast-title").value = params.get("title") || "";
  settings.querySelector("#studio-visibility").value = ["server", "friends", "global"].includes(params.get("visibility")) ? params.get("visibility") : "global";
  for (const server of servers) { const option = new Option(server.name, server.id); settings.querySelector("#studio-server").add(option); }
  settings.querySelector("#studio-server").value = params.get("serverId") || "";
  this.host.querySelector('[data-studio="exit"]').textContent = "Studio’yu kapat";
  this.host.querySelector(".studio-hint").textContent = "Hazırlık ve testler yalnızca sende görünür. Ana YAAS penceresini kapatsan da Studio açıkken yayın sürer.";
  const devices = document.createElement("div"); devices.className = "studio-device-selectors";
  devices.innerHTML = `<label>Kamera seç<select id="studio-camera-device"><option value="">Varsayılan kamera</option></select></label><label>Mikrofon seç<select id="studio-mic-device"><option value="">Varsayılan mikrofon</option></select></label><button class="secondary" id="studio-refresh-devices">Aygıtları yenile</button><small>Aygıt adları izin verdikten sonra görünür.</small>`;
  this.host.querySelector(".studio-sources").append(devices);
  for (const kind of ["camera", "mic"]) {
    devices.querySelector(`#studio-${kind}-device`).onchange = async event => {
      this[`${kind}DeviceId`] = event.target.value;
      if (this.sources[kind]) { this.removeSource(kind); await this.toggleSource(kind); }
    };
  }
  devices.querySelector("#studio-refresh-devices").onclick = () => this.refreshDevices();
  this.refreshDevices();
  const intro = document.createElement("div");
  intro.innerHTML = `<label>Başlangıç yazısı<input id="studio-intro-title" maxlength="80" value="Yayın birazdan başlıyor"></label><label>Giriş görseli / videosu<input id="studio-intro-file" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"></label><small>En fazla 50 MB · video sessiz oynatılır</small><button class="secondary" id="studio-intro-remove">Giriş medyasını kaldır</button>`;
  this.host.querySelector(".studio-decoration").append(intro);
  this.introTitle = "Yayın birazdan başlıyor";
  intro.querySelector("#studio-intro-title").oninput = event => { this.introTitle = event.target.value; };
  intro.querySelector("#studio-intro-file").onchange = event => this.loadIntro(event.target.files[0]);
  intro.querySelector("#studio-intro-remove").onclick = () => { this.clearIntro(); intro.querySelector("#studio-intro-file").value = ""; };
  const introButton = document.createElement("button"); introButton.dataset.scene = "intro"; introButton.textContent = "00  Başlangıç";
  introButton.onclick = () => { this.scene = "intro"; this.sync(); };
  this.host.querySelector(".studio-scenes h2").after(introButton);
  const testPanel = document.createElement("section"); testPanel.className = "studio-panel studio-tests";
  testPanel.innerHTML = `<h2>Yayın öncesi test</h2><label>Mikrofon seviyesi<meter id="studio-mic-meter" min="0" max="1" value="0"></meter></label><div class="studio-transport"><button class="secondary" id="studio-test-mic">5 sn ses testi</button><button class="secondary" id="studio-test-video">5 sn yayın provası</button><button class="secondary" id="studio-test-connection">Bağlantıyı kontrol et</button></div><p id="studio-test-result" role="status">Kaynaklarını aç ve kısa bir prova kaydet. Kayıt sunucuya gönderilmez.</p><video id="studio-test-playback" controls playsinline hidden></video>`;
  this.host.querySelector(".studio-layout").append(testPanel);
  testPanel.querySelector("#studio-test-mic").onclick = () => this.recordTest(true);
  testPanel.querySelector("#studio-test-video").onclick = () => this.recordTest(false);
  testPanel.querySelector("#studio-test-connection").onclick = async () => {
    const started = performance.now();
    try { await streamRtcApi("config"); testPanel.querySelector("#studio-test-result").textContent = `Sunucuya bağlantı kuruldu: ${Math.round(performance.now() - started)} ms. Bu kontrol izleyici bağlantısını veya yayın kapasitesini ölçmez.`; }
    catch { testPanel.querySelector("#studio-test-result").textContent = "Sunucuya ulaşılamadı. Bağlantını kontrol et."; }
  };
  const activity = document.createElement("section"); activity.className = "studio-panel studio-activity";
  activity.innerHTML = `<div><h2>Canlı sohbet</h2><div id="stream-live-chat" class="studio-chat-messages" role="log" aria-label="Canlı sohbet"></div><form id="stream-chat-form"><input id="stream-chat-input" aria-label="Sohbet mesajı" placeholder="Mesaj yaz" maxlength="500"><button class="secondary" type="submit">Gönder</button></form><small>Son 100 mesaj bu canlı oturum boyunca tutulur.</small></div><div><h2>Yayın bildirimleri</h2><div id="studio-events" role="log" aria-label="Yayın bildirimleri"></div></div>`;
  this.host.querySelector(".studio-layout").append(activity);
  bindLiveChat(this.host);
  this.addEvent("Studio hazır. Henüz canlı değilsin.");
  this.meterTimer = setInterval(() => {
    const mic = this.sources.mic;
    if (mic && !mic.analyser && this.audioContext) { mic.analyser = this.audioContext.createAnalyser(); mic.analyser.fftSize = 256; mic.audio.connect(mic.analyser); }
    let level = 0;
    if (mic?.analyser) { const samples = new Float32Array(256); mic.analyser.getFloatTimeDomainData(samples); level = Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 3); }
    testPanel.querySelector("#studio-mic-meter").value = level;
  }, 100);
};

YaasStudio.prototype.refreshDevices = async function() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const [kind, type] of [["camera", "videoinput"], ["mic", "audioinput"]]) {
      const select = this.host?.querySelector(`#studio-${kind}-device`); if (!select) continue;
      select.replaceChildren(new Option(kind === "camera" ? "Varsayılan kamera" : "Varsayılan mikrofon", ""));
      devices.filter(device => device.kind === type).forEach((device, index) => select.add(new Option(device.label || `${kind === "camera" ? "Kamera" : "Mikrofon"} ${index + 1}`, device.deviceId)));
      select.value = this[`${kind}DeviceId`] || "";
    }
  } catch { this.options.notify("Aygıtlar okunamadı. Kamera veya mikrofon iznini kontrol et.", true); }
};

YaasStudio.prototype.clearIntro = function() {
  this.introMedia?.pause?.();
  if (this.introUrl) URL.revokeObjectURL(this.introUrl);
  this.introUrl = null; this.introMedia = null;
};
YaasStudio.prototype.loadIntro = async function(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"].includes(file.type)) return this.options.notify("50 MB altında PNG, JPG, WebP, MP4 veya WebM seç.", true);
  this.clearIntro();
  try {
    if (file.type.startsWith("video/")) {
      this.introUrl = URL.createObjectURL(file);
      const video = document.createElement("video"); video.src = this.introUrl; video.muted = true; video.loop = true; video.playsInline = true;
      this.introMedia = video; await video.play();
    } else {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const img = new Image(); img.src = data; await img.decode(); if (!this.closed) this.introMedia = img;
    }
    if (this.closed) { this.clearIntro(); return; }
    this.scene = "intro"; this.sync();
  } catch { this.clearIntro(); this.options.notify("Giriş medyası açılamadı.", true); }
};

YaasStudio.prototype.recordTest = async function(audioOnly) {
  if (this.testRecorder?.state === "recording" || this.busy.has("test") || this.busy.has("live")) return;
  if (this.live) return this.options.notify("Prova için önce canlı yayını durdur.", true);
  if (audioOnly && !this.sources.mic) return this.options.notify("Ses testi için mikrofonu aç.", true);
  this.busy.add("test"); this.sync();
  let tracks = [];
  try {
    await this.audio();
    if (this.closed) return;
    const playback = this.host.querySelector("#studio-test-playback"); playback.pause();
    const result = this.host.querySelector("#studio-test-result");
    tracks = audioOnly ? this.sources.mic.stream.getAudioTracks().map(track => track.clone()) : [...this.canvas.captureStream(30).getVideoTracks(), ...this.destination.stream.getAudioTracks().map(track => track.clone())];
    const recorder = new MediaRecorder(new MediaStream(tracks)); this.testRecorder = recorder;
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      tracks.forEach(track => track.stop());
      if (this.closed) return;
      if (this.testUrl) URL.revokeObjectURL(this.testUrl);
      this.testUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      playback.src = this.testUrl; playback.hidden = false;
      result.textContent = "Prova hazır. Oynatıp görüntüyü ve sesi kontrol et; henüz yayında değilsin.";
      this.testRecorder = null; this.busy.delete("test"); this.sync();
    };
    recorder.start(); result.textContent = "5 saniye kaydediliyor… Konuşarak sesini dene."; this.sync();
    this.testStopTimer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 5000);
  } catch (error) { tracks.forEach(track => track.stop()); this.busy.delete("test"); this.sync(); this.options.notify("Bu tarayıcıda prova kaydı açılamadı: " + error.message, true); }
};
