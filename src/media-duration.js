"use strict";
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
let active = 0;
async function enforceMediaDuration(attachment) {
  if (!attachment || !/^(audio|video)\//.test(attachment.mime)) return;
  if (active >= 2) throw Object.assign(new Error('Medya kontrolü yoğun. Biraz sonra tekrar dene.'), {statusCode: 503});
  active++;
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaas-media-'));
    const file = path.join(directory, 'upload');
    await fs.writeFile(file, attachment.bytes, {mode: 0o600});
    const executable = require('@derhuerst/ffprobe-static');
    const {stdout} = await run(executable, ['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration:stream=codec_type,duration:packet=pts_time,duration_time','-show_packets','-of','json',file], {timeout:15000, maxBuffer:16*1024*1024, windowsHide:true});
    const data = JSON.parse(stdout);
    if (!data.streams?.some(s=>s.codec_type === (attachment.mime.startsWith('video/')?'video':'audio'))) throw new Error('stream');
    const durations = [Number(data.format?.duration), ...(data.streams||[]).map(s=>Number(s.duration))];
    for (const packet of data.packets||[]) {
      const start = Number(packet.pts_time), length = Number(packet.duration_time || 0);
      if (Number.isFinite(start) && start >= 0 && Number.isFinite(length)) durations.push(start+length);
    }
    const duration = durations.reduce((max, value)=>Number.isFinite(value)?Math.max(max,value):max,0);
    if (!(duration>0)) throw new Error('duration');
    if (duration>120) throw Object.assign(new Error('Ses kayıtları ve videolar en fazla 2 dakika olabilir.'),{statusCode:400});
    attachment.duration = duration;
  } catch(error) {
    if (error.statusCode) throw error;
    throw Object.assign(new Error('Ses veya videonun süresi doğrulanamadı. Geçerli bir dosya seç.'),{statusCode:400});
  } finally {
    if (directory) await fs.rm(directory,{recursive:true,force:true});
    active--;
  }
}
module.exports = {enforceMediaDuration};
