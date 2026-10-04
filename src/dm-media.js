"use strict";
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "video/webm", "video/mp4"]);
function invalid(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
function validateDmAttachment(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value) || typeof value.data !== "string") throw invalid("Geçersiz dosya");
  const match = value.data.match(/^data:([\w/+.-]+)(?:;codecs=[\w,.-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !MIME_TYPES.has(match[1]) || match[2].length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4) throw invalid("JPEG, PNG, WebP, WebM, MP4, Ogg veya WAV seç. Dosya en fazla 8 MB olabilir.");
  const bytes = Buffer.from(match[2], "base64"), mime = match[1];
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES || bytes.toString("base64") !== match[2]) throw invalid("Dosya boyutu veya kodlaması geçersiz");
  const prefix = bytes.subarray(0, 12);
  const png = prefix.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255;
  const webp = prefix.toString("ascii",0,4) === "RIFF" && prefix.toString("ascii",8,12) === "WEBP";
  const wav = prefix.toString("ascii",0,4) === "RIFF" && prefix.toString("ascii",8,12) === "WAVE";
  const webm = prefix.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  const mp4 = prefix.toString("ascii",4,8) === "ftyp";
  const ogg = prefix.toString("ascii",0,4) === "OggS";
  const valid = mime === "image/png" ? png : mime === "image/jpeg" ? jpeg : mime === "image/webp" ? webp : mime === "audio/wav" ? wav : mime === "audio/ogg" ? ogg : mime.endsWith("/webm") ? webm : mp4;
  if (!valid || bytes.length < 12) throw invalid("Dosyanın içeriği seçilen türle eşleşmiyor");
  const name = String(value.name || "medya").replace(/[\x00-\x1f\x7f\\/]/g, "_").slice(0,100);
  return { name, mime, bytes, size: bytes.length };
}
function mediaRange(header, length) {
  if (!header) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length-1, Number(match[2])) : length-1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= length) return null;
  return { start, end, partial: true };
}
module.exports = { MAX_MEDIA_BYTES, MIME_TYPES, validateDmAttachment, mediaRange };
