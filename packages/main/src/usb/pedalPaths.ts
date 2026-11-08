/**
 * Virtual paths for content that lives on a pedal connected over USB.
 *
 * The renderer works with folder paths (`currentFolder`, `wavPath`). For a
 * pedal bank it gets `jamman-pedal://<bank>` instead of a disk path, and the
 * main process routes every handler that receives one to the pedal. Only the
 * shapes the pedal itself uses are accepted (`PatchNN/PhraseX/phrase.wav`), so
 * a renderer cannot name any other file on the device.
 *
 * @module usb/pedalPaths
 */
import type { PedalBankId } from '@app/preload/ipc-contract';

export const PEDAL_PATH_PREFIX = 'jamman-pedal://';
export const PEDAL_BANKS: readonly PedalBankId[] = ['internal', 'sd'];

export const PATCH_DIR_RE = /^Patch\d{2}$/;
export const PHRASE_DIR_RE = /^Phrase[A-Z]$/;

const WAV_PATH_RE = /^jamman-pedal:\/\/(internal|sd)\/(Patch\d{2})\/(Phrase[A-Z])\/phrase\.wav$/;
const BANK_PATH_RE = /^jamman-pedal:\/\/(internal|sd)\/?$/;

export function isPedalPath(value: unknown): value is `jamman-pedal://${string}` {
  return typeof value === 'string' && value.startsWith(PEDAL_PATH_PREFIX);
}

/** `jamman-pedal://sd` */
export function bankPath(bank: PedalBankId): string {
  return `${PEDAL_PATH_PREFIX}${bank}`;
}

/** `jamman-pedal://sd/Patch01/PhraseA/phrase.wav` */
export function wavPath(bank: PedalBankId, patch: string, phrase: string): string {
  return `${bankPath(bank)}/${patch}/${phrase}/phrase.wav`;
}

/** The bank of `jamman-pedal://<bank>`, or null. */
export function parseBankPath(value: unknown): PedalBankId | null {
  if (typeof value !== 'string') return null;
  const match = BANK_PATH_RE.exec(value);
  return match ? (match[1] as PedalBankId) : null;
}

export type PedalWavRef = { bank: PedalBankId; patch: string; phrase: string };

/** The parts of a phrase WAV path, or null when it is not exactly that shape. */
export function parseWavPath(value: unknown): PedalWavRef | null {
  if (typeof value !== 'string') return null;
  const match = WAV_PATH_RE.exec(value);
  return match ? { bank: match[1] as PedalBankId, patch: match[2], phrase: match[3] } : null;
}

/** Thrown by local-folder handlers that cannot work on a pedal (yet). */
export class PedalNotSupportedError extends Error {
  constructor(action: string) {
    super(`${action} is not available for a pedal connected over USB yet`);
    this.name = 'PedalNotSupportedError';
  }
}

/** Throws when a handler that only works on a local folder receives a pedal path. */
export function assertNotPedal(value: unknown, action: string): void {
  if (isPedalPath(value)) {
    throw new PedalNotSupportedError(action);
  }
}
