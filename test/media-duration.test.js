const test = require('node:test');
const assert = require('node:assert/strict');
const {enforceMediaDuration} = require('../src/media-duration');
function wav(seconds) {
  const rate=8000, length=rate*seconds*2, bytes=Buffer.alloc(44+length);
  bytes.write('RIFF'); bytes.writeUInt32LE(36+length,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24); bytes.writeUInt32LE(rate*2,28);
  bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(length,40);
  return {mime:'audio/wav',bytes};
}
test('server measures actual audio and rejects more than 120 seconds',async()=>{
  const exact=wav(120);await enforceMediaDuration(exact);assert.equal(exact.duration,120);
  await assert.rejects(enforceMediaDuration(wav(121)),/2 dakika/);
  await assert.rejects(enforceMediaDuration({mime:'video/webm',bytes:Buffer.from('invalid')}),/doğrulanamadı/);
  await enforceMediaDuration({mime:'image/png',bytes:Buffer.from('image')});
});
