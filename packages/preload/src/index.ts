import { sha256sum } from "./nodeCrypto.js";
import { versions } from "./versions.js";
import { contextBridge, ipcRenderer } from "electron";

function send(channel: string, message: string) {
  return ipcRenderer.invoke(channel, message);
}

export type PhrasePayload = {
  name: string;
  wavPath: string;
  tempo: number;
  timeSignature: string;
  loopType: string;
};

export type PatchPayload = {
  basePath: string;
  patchName: string;
  directory: string;
  rhythmType: string;
  stopMode: string;
  settingsVersion?: string;
  phrases: PhrasePayload[];
};

type AudioValidationResult = {
  valid: boolean;
  sampleRate?: number;
  bitsPerSample?: number;
  numberOfChannels?: number;
  duration?: number;
  error?: string;
};

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  readPatches: (folderPath: string) =>
    ipcRenderer.invoke("patches:read", folderPath),
  getAudioURL: (wavPath: string) =>
    ipcRenderer.invoke("phrase:getAudioURL", wavPath),
  validateWav: (wavPath: string): Promise<AudioValidationResult> =>
    ipcRenderer.invoke("audio:validateWav", wavPath),
  selectFile: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:selectFile", {
      filters: [{ name: "Audio", extensions: ["wav"] }],
      properties: ["openFile"],
    }),
  createPatch: (data: PatchPayload): Promise<void> =>
    ipcRenderer.invoke("patches:create", data),
  updatePatch: (data: PatchPayload): Promise<void> =>
    ipcRenderer.invoke("patches:update", data),
  deletePatch: (basePath: string, directory: string): Promise<void> =>
    ipcRenderer.invoke("patches:delete", basePath, directory),
  reorderPatches: (basePath: string, patches: string[]): Promise<void> =>
    ipcRenderer.invoke("patches:reorder", basePath, patches),
});

export { sha256sum, versions, send };
