import * as fs from 'fs';
import * as path from 'path';

/**
 * Deterministic synthetic JamMan SD card used to generate and verify the
 * legacy backup fixtures in this folder. Test-only: nothing in the app imports it.
 */

/** Builds a tiny, valid 16-bit stereo PCM WAV with a deterministic waveform. */
export function makeWav(frames: number, seed: number): Buffer {
  const channels = 2;
  const sampleRate = 44100;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames * channels; i++) {
    buf.writeInt16LE(((i * 37 + seed * 101) % 2000) - 1000, 44 + i * bytesPerSample);
  }
  return buf;
}

function patchXml(id: string, name: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<JamManPatch>
  <ID>${id}</ID>
  <PatchName>${name}</PatchName>
  <Tempo>120</Tempo>
</JamManPatch>
`;
}

function phraseXml(id: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<JamManPhrase>
  <ID>${id}</ID>
  <Reverse>0</Reverse>
</JamManPhrase>
`;
}

/** Relative path -> file content of every file on the synthetic SD. */
export function syntheticSdFiles(): Record<string, Buffer> {
  return {
    'Patch01/patch.xml': Buffer.from(patchXml('patch-id-01', 'Intro Groove')),
    'Patch01/PhraseA/phrase.xml': Buffer.from(phraseXml('phrase-01-a')),
    'Patch01/PhraseA/phrase.wav': makeWav(441, 1),
    'Patch02/patch.xml': Buffer.from(patchXml('patch-id-02', 'Verse Loop')),
    'Patch02/PhraseA/phrase.xml': Buffer.from(phraseXml('phrase-02-a')),
    'Patch02/PhraseA/phrase.wav': makeWav(441, 2),
    'Patch02/PhraseB/phrase.xml': Buffer.from(phraseXml('phrase-02-b')),
    'Patch02/PhraseB/phrase.wav': makeWav(220, 3),
    'Patch05/patch.xml': Buffer.from(patchXml('patch-id-05', 'Outro')),
    'Patch05/PhraseA/phrase.xml': Buffer.from(phraseXml('phrase-05-a')),
    'Patch05/PhraseA/phrase.wav': makeWav(100, 5),
  };
}

/** Legacy `.jamman-playlists.json` content (version 2.0, no schemaVersion). */
export function syntheticPlaylists(): string {
  return JSON.stringify(
    {
      version: '2.0',
      playlists: [
        {
          id: '11111111-2222-4333-8444-555555555555',
          name: 'Gig set',
          patchIds: ['patch-id-02', 'patch-id-01'],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        },
      ],
    },
    null,
    2,
  );
}

/** Writes the synthetic SD into `dir` (which must exist). */
export function writeSyntheticSd(dir: string, withPlaylists = true): void {
  for (const [rel, content] of Object.entries(syntheticSdFiles())) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  if (withPlaylists) {
    fs.writeFileSync(path.join(dir, '.jamman-playlists.json'), syntheticPlaylists());
  }
}
