"use strict";

// A single composed video and mixed audio track stay stable as sources change.
class YaasStudio {
  constructor(options) {
    this.options = options;
    this.sources = {};
    this.scene = "main";
    this.color = "#d7b66d";
    this.caption = "";
    this.live = false;
    this.closed = false;
    this.busy = new Set();
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.context = this.canvas.getContext("2d");
    this.draw();
    this.timer = setInterval(() => this.draw(), 1000 / 30);
  }

  mount(host, title, viewers) {
    if (host.querySelector(".yaas-studio") && this.host === host) {
      host.querySelector("#studio-viewers").textContent = `${viewers} izleyici`;
      return;
    }
    this.host = host;
    host.innerHTML = `
      <section class="yaas-studio">
        <header class="studio-header"><div><span class="studio-eyebrow">YAYIN KONTROL ODASI</span><h1>YAAS <em>Studio</em></h1><p id="studio-title"></p></div><div class="studio-header-actions"><span id="studio-viewers"></span><button class="secondary" data-studio="exit">← Yayınlara dön</button></div></header>
        <div class="studio-layout">
          <aside class="studio-panel studio-scenes"><h2>Sahneler</h2><button data-scene="main" class="selected"><span>01</span> Ana yayın</button><button data-scene="camera"><span>02</span> Kamera</button><button data-scene="break"><span>03</span> Mola</button><p>Sahne değişiklikleri yayındayken anında görünür.</p></aside>
          <main class="studio-main"><div class="studio-preview-bar"><strong>Program önizlemesi</strong><span id="studio-status" role="status"></span></div><div class="studio-canvas-slot"></div><div class="studio-transport"><button class="primary" data-studio="live">Yayına ver</button><button class="danger-button" data-studio="end">Yayını bitir</button></div><p class="studio-hint">Önce kaynaklarını ve sahneni hazırla, ardından yayına ver.</p></main>
          <aside class="studio-panel studio-decoration"><h2>Sahne tasarımı</h2><label>Yayın yazısı<input id="studio-caption" maxlength="100" placeholder="İsim, konu veya duyuru"></label><label>Vurgu rengi<input id="studio-color" type="color" value="#d7b66d"></label><label class="studio-file">Logo ekle<input id="studio-logo" type="file" accept="image/png,image/jpeg,image/webp"></label><small>PNG, JPG veya WebP · en fazla 5 MB</small><button class="secondary" data-studio="remove-logo">Logoyu kaldır</button></aside>
          <section class="studio-panel studio-sources"><h2>Görüntü kaynakları</h2><div class="studio-source-row"><div><strong>Ekran paylaşımı</strong><small id="studio-screen-state">Kapalı</small></div><button class="secondary" data-source="screen">Ekran seç</button></div><div class="studio-source-row"><div><strong>Kamera</strong><small id="studio-camera-state">Kapalı</small></div><button class="secondary" data-source="camera">Kamera aç</button></div><p>Ana yayında kamera, ekranın sağ alt köşesinde görünür.</p></section>
          <section class="studio-panel studio-audio"><h2>Ses mikseri</h2><div class="studio-source-row"><strong>Mikrofon</strong><button class="secondary" data-source="mic">Mikrofon aç</button></div><label>Mikrofon seviyesi<input id="studio-mic-gain" type="range" min="0" max="100" value="100"></label><label>Ekran sesi<input id="studio-screen-gain" type="range" min="0" max="100" value="100"></label><small id="studio-audio-note">Ekran sesi için paylaşım penceresinde ses paylaşımını seç.</small></section>
        </div>
      </section>`;
    host.querySelector("#studio-title").textContent = title;
    host.querySelector("#studio-viewers").textContent = `${viewers} izleyici`;
    host.querySelector(".studio-canvas-slot").append(this.canvas);
    this.canvas.setAttribute("aria-label", "İzleyiciye gönderilecek yayın sahnesi");
    host.querySelectorAll("[data-source]").forEach(button => button.onclick = () => this.toggleSource(button.dataset.source));
    host.querySelectorAll("[data-scene]").forEach(button => button.onclick = () => { this.scene = button.dataset.scene; this.sync(); });
    host.querySelector("#studio-caption").value = this.caption;
    host.querySelector("#studio-caption").oninput = event => { this.caption = event.target.value; };
    host.querySelector("#studio-color").value = this.color;
    host.querySelector("#studio-color").oninput = event => { this.color = event.target.value; };
    host.querySelector("#studio-logo").onchange = event => this.loadLogo(event.target.files[0]);
    host.querySelector('[data-studio="remove-logo"]').onclick = () => { this.logo = null; host.querySelector("#studio-logo").value = ""; };
    for (const kind of ["mic", "screen"]) {
      const slider = host.querySelector(`#studio-${kind}-gain`);
      slider.value = (this[`${kind}Gain`] ?? 1) * 100;
      slider.oninput = () => { this[`${kind}Gain`] = Number(slider.value) / 100; this.updateGains(); };
    }
    host.querySelector('[data-studio="live"]').onclick = () => this.toggleLive();
    host.querySelector('[data-studio="end"]').onclick = () => this.options.end();
    host.querySelector('[data-studio="exit"]').onclick = () => this.options.exit();
    this.sync();
  }

  async audio() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.destination = this.audioContext.createMediaStreamDestination();
    }
    await this.audioContext.resume();
  }

  async toggleSource(kind) {
    if (this.busy.has(kind) || this.closed) return;
    if (this.sources[kind]) { this.removeSource(kind); return; }
    this.busy.add(kind); this.sync();
    let stream;
    try {
      if (!navigator.mediaDevices) throw new Error("Bu tarayıcı medya paylaşımını desteklemiyor. HTTPS veya localhost kullan.");
      stream = kind === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
        : await navigator.mediaDevices.getUserMedia(kind === "camera"
          ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(this.cameraDeviceId ? { deviceId: { exact: this.cameraDeviceId } } : {}) }, audio: false }
          : { video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(this.micDeviceId ? { deviceId: { exact: this.micDeviceId } } : {}) } });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      const source = { stream };
      this.sources[kind] = source;
      if (stream.getVideoTracks().length) {
        source.video = document.createElement("video");
        source.video.muted = true; source.video.playsInline = true;
        source.video.srcObject = stream;
        await source.video.play();
      }
      if (this.closed) return;
      if (stream.getAudioTracks().length) {
        await this.audio();
        if (this.closed) return;
        source.audio = this.audioContext.createMediaStreamSource(stream);
        source.gain = this.audioContext.createGain();
        source.audio.connect(source.gain).connect(this.destination);
        this.updateGains();
      }
      const primary = kind === "mic" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (primary) primary.onended = () => { if (this.sources[kind] === source) this.removeSource(kind); };
      this.refreshDevices?.();
      this.addEvent?.(`${kind === "mic" ? "Mikrofon" : kind === "camera" ? "Kamera" : "Ekran paylaşımı"} açıldı.`);
    } catch (error) {
      this.removeSource(kind);
      stream?.getTracks().forEach(track => track.stop());
      if (!this.closed) this.options.notify(error.name === "NotAllowedError" ? "İzin verilmedi veya seçim iptal edildi. Tekrar deneyebilirsin." : (error.message || "Kaynak açılamadı"), true);
    } finally { this.busy.delete(kind); this.sync(); }
  }

  removeSource(kind) {
    const source = this.sources[kind];
    if (!source) return;
    delete this.sources[kind];
    source.stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    source.audio?.disconnect(); source.gain?.disconnect();
    if (source.video) { source.video.pause(); source.video.srcObject = null; }
    if (!this.closed) this.addEvent?.(`${kind === "mic" ? "Mikrofon" : kind === "camera" ? "Kamera" : "Ekran paylaşımı"} kapandı.`);
    this.sync();
  }

  updateGains() {
    for (const kind of ["mic", "screen"]) {
      if (this.sources[kind]?.gain) this.sources[kind].gain.gain.value = ["break", "intro"].includes(this.scene) ? 0 : (this[`${kind}Gain`] ?? 1);
    }
  }

  async loadLogo(file) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      this.options.notify("5 MB altında PNG, JPG veya WebP seç.", true); return;
    }
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Logo okunamadı"));
        reader.readAsDataURL(file);
      });
      const img = new Image(); img.src = data; await img.decode();
      if (!this.closed) this.logo = img;
    } catch { this.options.notify("Logo okunamadı", true); }
  }

  fit(image, x, y, width, height) {
    const iw = image.videoWidth || image.naturalWidth;
    const ih = image.videoHeight || image.naturalHeight;
    if (!iw || !ih) return;
    const scale = Math.min(width / iw, height / ih);
    this.context.drawImage(image, x + (width - iw * scale) / 2, y + (height - ih * scale) / 2, iw * scale, ih * scale);
  }

  draw() {
    const ctx = this.context;
    ctx.fillStyle = "#0b1018"; ctx.fillRect(0, 0, 1280, 720);
    const camera = this.sources.camera?.video;
    const screen = this.sources.screen?.video;
    const main = this.scene === "camera" ? camera : screen || camera;
    if (this.scene === "intro" && this.introMedia) this.fit(this.introMedia, 0, 0, 1280, 720);
    else if (!["break", "intro"].includes(this.scene) && main) this.fit(main, 0, 0, 1280, 720);
    else {
      ctx.fillStyle = this.color; ctx.font = "bold 58px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(this.scene === "intro" ? this.introTitle || "Yayın birazdan başlıyor" : this.scene === "break" ? "Birazdan buradayız" : "YAAS Studio", 640, 340, 1180);
      ctx.fillStyle = "#aab4c4"; ctx.font = "26px sans-serif";
      ctx.fillText(this.scene === "break" ? "Yayın kısa bir aradan sonra devam edecek" : "Yayın hazırlanıyor", 640, 392);
      ctx.textAlign = "left";
    }
    if (this.scene === "main" && screen && camera) {
      ctx.fillStyle = this.color; ctx.fillRect(946, 456, 302, 172);
      ctx.fillStyle = "#0b1018"; ctx.fillRect(950, 460, 294, 164);
      this.fit(camera, 950, 460, 294, 164);
    }
    if (this.logo) this.fit(this.logo, 1100, 28, 148, 100);
    if (this.caption) {
      ctx.fillStyle = "rgba(8,12,20,.88)"; ctx.fillRect(32, 644, 1216, 52);
      ctx.fillStyle = this.color; ctx.fillRect(32, 644, 6, 52);
      ctx.fillStyle = "#ffffff"; ctx.font = "28px sans-serif";
      ctx.fillText(this.caption, 54, 679, 1170);
    }
  }

  async toggleLive() {
    if (this.busy.has("live") || this.busy.has("test") || this.closed || this.testRecorder?.state === "recording") return;
    this.host?.querySelector("#studio-test-playback")?.pause();
    this.busy.add("live"); this.sync();
    try {
      if (this.live) {
        await this.options.stop(); this.live = false;
        this.output?.getTracks().forEach(track => track.stop()); this.output = null;
      } else {
        await this.audio();
        if (this.closed) return;
        this.draw();
        const video = this.canvas.captureStream(30);
        // Clone the destination track so stopping a broadcast preserves the mixer.
        this.output = new MediaStream([...video.getVideoTracks(), ...this.destination.stream.getAudioTracks().map(track => track.clone())]);
        await this.options.start(this.output);
        this.live = !this.closed;
      }
    } catch (error) {
      this.output?.getTracks().forEach(track => track.stop()); this.output = null;
      this.live = false;
      this.options.notify(error.message || "Yayın başlatılamadı", true);
    } finally { this.busy.delete("live"); this.sync(); }
  }

  sync() {
    this.updateGains();
    if (!this.host || this.closed) return;
    const find = selector => this.host.querySelector(selector);
    const status = find("#studio-status");
    if (!status) return;
    status.textContent = this.live ? "● CANLI" : "● ÖNİZLEME";
    status.classList.toggle("is-live", this.live);
    const live = find('[data-studio="live"]');
    live.textContent = this.live ? "Canlı yayını durdur" : "Canlı yayını başlat";
    live.disabled = this.busy.has("live") || this.busy.has("test") || this.testRecorder?.state === "recording";
    find('[data-studio="end"]').disabled = this.busy.has("live") || !this.live;
    find('[data-studio="exit"]').disabled = this.busy.has("live");
    for (const kind of ["camera", "screen", "mic"]) {
      const enabled = Boolean(this.sources[kind]);
      const button = find(`[data-source="${kind}"]`);
      button.textContent = enabled ? ({ camera: "Kamerayı kapat", screen: "Paylaşımı durdur", mic: "Mikrofonu kapat" })[kind] : ({ camera: "Kamera aç", screen: "Ekran seç", mic: "Mikrofon aç" })[kind];
      button.disabled = this.busy.has(kind);
      button.setAttribute("aria-pressed", String(enabled));
      const label = find(`#studio-${kind}-state`);
      if (label) label.textContent = enabled ? "Açık" : "Kapalı";
    }
    this.host.querySelectorAll("[data-scene]").forEach(button => {
      button.classList.toggle("selected", button.dataset.scene === this.scene);
      button.setAttribute("aria-pressed", String(button.dataset.scene === this.scene));
    });
    find("#studio-audio-note").textContent = ["break", "intro"].includes(this.scene) ? "Başlangıç ve mola sahnelerinde mikrofon ile ekran sesi kapalı." : this.sources.screen && !this.sources.screen.stream.getAudioTracks().length ? "Bu ekran paylaşımında ses yok. Ses paylaşımı seçeneğiyle yeniden açabilirsin." : "Ekran sesi için paylaşım penceresinde ses paylaşımını seç.";
    this.updateGains();
  }

  dispose() {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.meterTimer);
    clearTimeout(this.testStopTimer);
    if (this.testRecorder?.state === "recording") this.testRecorder.stop();
    this.host?.querySelector("#studio-test-playback")?.pause();
    if (this.testUrl) URL.revokeObjectURL(this.testUrl);
    this.clearIntro?.();
    for (const kind of Object.keys(this.sources)) this.removeSource(kind);
    this.output?.getTracks().forEach(track => track.stop());
    this.audioContext?.close().catch(() => {});
    this.logo = null;
  }
}

window.YaasStudio = YaasStudio;
