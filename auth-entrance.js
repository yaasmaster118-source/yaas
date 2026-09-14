"use strict";
class YaasEntrance {
  constructor(root) {
    this.root = root;
    this.video = root.querySelector("video");
    this.button = root.querySelector("[data-auth-motion]");
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.paused = this.reduced.matches;
    this.button.addEventListener("click", () => { this.paused = !this.paused; this.updateMotion(); });
    this.video.addEventListener("playing", () => root.classList.add("auth-video-ready"));
    this.video.addEventListener("error", () => root.classList.remove("auth-video-ready"));
    this.reduced.addEventListener("change", () => { this.paused = this.reduced.matches; this.updateMotion(); });
    document.addEventListener("visibilitychange", () => this.updateMotion());
    this.updateMotion();
  }
  updateMotion() {
    if (this.paused || this.root.classList.contains("hidden") || document.hidden) this.video.pause();
    else this.video.play().catch(() => {});
    this.button.textContent = this.paused ? "Arka planı oynat" : "Hareketi durdur";
    this.button.setAttribute("aria-pressed", String(this.paused));
  }
  show() { this.root.classList.remove("auth-entering"); this.root.removeAttribute("aria-busy"); this.updateMotion(); }
  hide() { this.video.pause(); }
  async enter(reveal) {
    if (this.entering) return;
    this.entering = true;
    this.root.setAttribute("aria-busy", "true");
    this.root.querySelector(".auth-entry-status").textContent = "YAAS’a giriliyor…";
    this.root.classList.add("auth-entering");
    try {
      await new Promise(resolve => setTimeout(resolve, this.reduced.matches ? 140 : 1850));
      reveal();
      document.getElementById("app").classList.add("auth-arrived");
      setTimeout(() => document.getElementById("app").classList.remove("auth-arrived"), 650);
      if (!document.getElementById("app").classList.contains("hidden")) document.getElementById("nav-home-button")?.focus({ preventScroll: true });
    } finally {
      this.video.pause(); this.root.classList.remove("auth-entering"); this.root.removeAttribute("aria-busy");
      this.root.querySelector(".auth-entry-status").textContent = ""; this.entering = false;
    }
  }
}
window.yaasEntrance = new YaasEntrance(document.getElementById("auth-screen"));
