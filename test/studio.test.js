"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function harness() {
  const drawings = [];
  class Track {
    constructor(kind) { this.kind = kind; this.readyState = "live"; }
    stop() { this.readyState = "ended"; }
    clone() { return new Track(this.kind); }
  }
  class Stream {
    constructor(tracks = []) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
    getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
  }
  const makeStream = (...kinds) => new Stream(kinds.map(kind => new Track(kind)));
  const context = { fillRect() {}, fillText(...args) { drawings.push(args); }, drawImage(...args) { drawings.push(args); } };
  const canvas = { getContext: () => context, captureStream: () => makeStream("video") };
  const mediaDevices = {
    getDisplayMedia: async () => makeStream("video", "audio"),
    getUserMedia: async options => makeStream(options.video ? "video" : "audio")
  };
  class AudioContext {
    createMediaStreamDestination() { return { stream: makeStream("audio") }; }
    createMediaStreamSource() { return { connect(target) { return target; }, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    async resume() {}
    async close() { this.closed = true; }
  }
  const sandbox = {
    window: {}, document: { createElement: kind => kind === "canvas" ? canvas : { videoWidth: 1280, videoHeight: 720, async play() {}, pause() {} } },
    navigator: { mediaDevices }, AudioContext, MediaStream: Stream, setInterval: () => 1, clearInterval() {}, clearTimeout() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../studio.js"), "utf8"), sandbox);
  const errors = [];
  const studio = new sandbox.window.YaasStudio({ start: async () => {}, stop: async () => {}, notify: message => errors.push(message) });
  return { studio, mediaDevices, drawings, errors, makeStream };
}

test("studio pauses and resumes without ending microphone or mixer tracks", async () => {
  const { studio } = harness();
  await studio.toggleSource("mic");
  const microphone = studio.sources.mic.stream.getAudioTracks()[0];
  await studio.toggleLive();
  const firstOutput = studio.output;
  assert.equal(studio.live, true);
  assert.equal(firstOutput.getVideoTracks().length, 1);
  assert.equal(firstOutput.getAudioTracks().length, 1);
  await studio.toggleLive();
  assert.ok(firstOutput.getTracks().every(track => track.readyState === "ended"));
  assert.equal(microphone.readyState, "live");
  assert.equal(studio.destination.stream.getAudioTracks()[0].readyState, "live");
  await studio.toggleLive();
  assert.equal(studio.live, true);
  studio.dispose();
  assert.equal(microphone.readyState, "ended");
});

test("break scene silences both sources and restores chosen levels", async () => {
  const { studio } = harness();
  await studio.toggleSource("screen");
  await studio.toggleSource("mic");
  studio.micGain = .4;
  studio.scene = "break"; studio.sync();
  assert.equal(studio.sources.mic.gain.gain.value, 0);
  assert.equal(studio.sources.screen.gain.gain.value, 0);
  studio.scene = "main"; studio.sync();
  assert.equal(studio.sources.mic.gain.gain.value, .4);
  assert.equal(studio.sources.screen.gain.gain.value, 1);
  studio.dispose();
});

test("camera, screen, logo and caption are drawn into transmitted canvas", async () => {
  const { studio, drawings } = harness();
  await studio.toggleSource("screen");
  await studio.toggleSource("camera");
  studio.caption = "YAAS deneme";
  studio.logo = { naturalWidth: 100, naturalHeight: 100 };
  drawings.length = 0;
  studio.draw();
  assert.ok(drawings.some(args => args[0] === studio.sources.screen.video));
  assert.ok(drawings.some(args => args[0] === studio.sources.camera.video));
  assert.ok(drawings.some(args => args[0] === studio.logo));
  assert.ok(drawings.some(args => args[0] === "YAAS deneme"));
  studio.dispose();
});

test("closing studio while permission dialog is pending stops late tracks", async () => {
  const { studio, mediaDevices, makeStream } = harness();
  let resolve;
  mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
  const pending = studio.toggleSource("camera");
  studio.dispose();
  const late = makeStream("video");
  resolve(late); await pending;
  assert.ok(late.getTracks().every(track => track.readyState === "ended"));
  assert.equal(Object.keys(studio.sources).length, 0);
});

test("cancelled screen selection preserves other sources and allows retry", async () => {
  const { studio, mediaDevices, makeStream, errors } = harness();
  await studio.toggleSource("mic");
  mediaDevices.getDisplayMedia = async () => { const error = new Error(); error.name = "NotAllowedError"; throw error; };
  await studio.toggleSource("screen");
  assert.equal(studio.busy.size, 0);
  assert.ok(studio.sources.mic);
  assert.equal(errors.length, 1);
  mediaDevices.getDisplayMedia = async () => makeStream("video");
  await studio.toggleSource("screen");
  const screen = studio.sources.screen.stream.getVideoTracks()[0];
  screen.onended();
  assert.equal(studio.sources.screen, undefined);
  assert.ok(studio.sources.mic);
  studio.dispose();
});
