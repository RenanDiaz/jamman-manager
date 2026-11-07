#!/usr/bin/env node
/**
 * Regenerates the synthetic JamMan Stereo SD card in tests/fixtures/jamman-sd/.
 *
 * Everything is deterministic (fixed IDs, fixed waveform) so the committed
 * fixture can be rebuilt byte for byte:  node tests/fixtures/generate-jamman-sd.mjs
 *
 * Layout mirrors what packages/main/src/index.ts reads and writes:
 *   jamman-sd/PatchNN/patch.xml
 *   jamman-sd/PatchNN/PhraseX/phrase.xml
 *   jamman-sd/PatchNN/PhraseX/phrase.wav
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'jamman-sd');

/** Tiny PCM WAV: 16-bit stereo, 44.1 kHz, `frames` sample frames of a sine wave. */
function makeWav(frames, cycles) {
  const channels = 2;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(44100 * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * cycles * i) / frames) * 8000);
    buf.writeInt16LE(v, 44 + i * 4);
    buf.writeInt16LE(v, 44 + i * 4 + 2);
  }
  return buf;
}

const patchXml = ({ name, rhythm, stop, id, originId }) =>
  `<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>${name}</PatchName>
  <RhythmType>${rhythm}</RhythmType>
  <StopMode>${stop}</StopMode>
  <SettingsVersion>1</SettingsVersion>
  <ID>${id}</ID>
  <OriginID>${originId}</OriginID>
  <Metadata/>
</JamManPatch>
`;

const phraseXml = ({ bpm, beats, loop, reversed, id, originId }) =>
  `<?xml version="1.0" encoding="UTF-8" ?>
<JamManPhrase xmlns="http://schemas.digitech.com/JamMan/Phrase" version="1">
  <BeatsPerMinute>${bpm}</BeatsPerMinute>
  <BeatsPerMeasure>${beats}</BeatsPerMeasure>
  <BpmValidated>0</BpmValidated>
  <IsLoop>${loop ? 1 : 0}</IsLoop>
  <IsReversed>${reversed ? 1 : 0}</IsReversed>
  <SettingsVersion>1</SettingsVersion>
  <AudioVersion>1</AudioVersion>
  <ID>${id}</ID>
  <OriginID>${originId}</OriginID>
  <Metadata/>
</JamManPhrase>
`;

// Fixed, human-recognisable UUIDs so tests can assert on them.
const uuid = (group, n) =>
  `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const patches = [
  {
    dir: 'Patch01',
    name: 'Rock Groove',
    rhythm: 'Rock',
    stop: 'Immediate',
    phrases: [{ dir: 'PhraseA', bpm: 120, beats: 4, loop: true, reversed: false }],
  },
  {
    dir: 'Patch02',
    name: 'Waltz Pair',
    rhythm: 'Waltz',
    stop: 'EndOfPhrase',
    phrases: [
      { dir: 'PhraseA', bpm: 90, beats: 3, loop: true, reversed: false },
      { dir: 'PhraseB', bpm: 90, beats: 3, loop: false, reversed: true },
    ],
  },
  {
    dir: 'Patch03',
    name: 'Slow Blues',
    rhythm: 'Blues',
    stop: 'Immediate',
    phrases: [{ dir: 'PhraseA', bpm: 70, beats: 4, loop: false, reversed: false }],
  },
];

fs.rmSync(root, { recursive: true, force: true });

patches.forEach((patch, pi) => {
  const patchDir = path.join(root, patch.dir);
  fs.mkdirSync(patchDir, { recursive: true });
  fs.writeFileSync(
    path.join(patchDir, 'patch.xml'),
    patchXml({
      ...patch,
      id: uuid(0xa0, pi + 1),
      originId: uuid(0xa1, pi + 1),
    }),
  );
  patch.phrases.forEach((phrase, fi) => {
    const phraseDir = path.join(patchDir, phrase.dir);
    fs.mkdirSync(phraseDir);
    const n = (pi + 1) * 16 + fi + 1;
    fs.writeFileSync(
      path.join(phraseDir, 'phrase.xml'),
      phraseXml({ ...phrase, id: uuid(0xb0, n), originId: uuid(0xb1, n) }),
    );
    fs.writeFileSync(path.join(phraseDir, 'phrase.wav'), makeWav(64, pi + fi + 1));
  });
});

console.log(`Generated synthetic JamMan SD at ${root}`);
