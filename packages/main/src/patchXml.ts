/**
 * The XML the app writes for a patch (`patch.xml`) and a phrase (`phrase.xml`).
 * Shared by the local-folder handlers and the pedal over USB, so both write
 * exactly the same files.
 *
 * @module patchXml
 */
import type { PhraseForm } from '@app/preload/ipc-contract';

export type PatchXmlFields = {
  patchName: string;
  rhythmType: string;
  stopMode: string;
  settingsVersion: number;
  id: string;
  originId: string;
};

/** Characters XML 1.0 cannot contain at all, not even escaped (control codes, lone surrogates, U+FFFE/F; the `u` flag keeps emoji pairs). */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/**
 * Makes user text safe inside an XML element: escapes `& < > " '` and drops the
 * characters XML 1.0 forbids. The parser decodes the five entities on read, so
 * write → read keeps the original text.
 */
export function escapeXml(text: string): string {
  return String(text)
    .replace(XML_ILLEGAL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildPatchXml(p: PatchXmlFields): string {
  return `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>${escapeXml(p.patchName)}</PatchName>
  <RhythmType>${escapeXml(p.rhythmType)}</RhythmType>
  <StopMode>${escapeXml(p.stopMode)}</StopMode>
  <SettingsVersion>${escapeXml(String(p.settingsVersion))}</SettingsVersion>
  <ID>${escapeXml(p.id)}</ID>
  <OriginID>${escapeXml(p.originId)}</OriginID>
  <Metadata/>
</JamManPatch>`.trim();
}

export function buildPhraseXml(phrase: PhraseForm, id: string, originId: string): string {
  return `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPhrase xmlns="http://schemas.digitech.com/JamMan/Phrase" version="1">
  <BeatsPerMinute>${phrase.beatsPerMinute}</BeatsPerMinute>
  <BeatsPerMeasure>${phrase.beatsPerMeasure}</BeatsPerMeasure>
  <BpmValidated>0</BpmValidated>
  <IsLoop>${phrase.isLoop ? 1 : 0}</IsLoop>
  <IsReversed>${phrase.isReversed ? 1 : 0}</IsReversed>
  <SettingsVersion>1</SettingsVersion>
  <AudioVersion>1</AudioVersion>
  <ID>${escapeXml(id)}</ID>
  <OriginID>${escapeXml(originId)}</OriginID>
  <Metadata/>
</JamManPhrase>`.trim();
}
