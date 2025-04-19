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

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  readPatches: (folderPath: string) =>
    ipcRenderer.invoke("patches:read", folderPath),
  getAudioURL: (wavPath: string) =>
    ipcRenderer.invoke("phrase:getAudioURL", wavPath),
  selectFile: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:selectFile", {
      filters: [{ name: "Audio", extensions: ["wav"] }],
      properties: ["openFile"],
    }),
  createPatch: (data: PatchPayload): Promise<void> =>
    ipcRenderer.invoke("patches:create", data),
  updatePatch: (data: PatchPayload): Promise<void> =>
    ipcRenderer.invoke("patches:update", data),
  deletePatch: (directory: string, basePath: string): Promise<void> =>
    ipcRenderer.invoke("patches:delete", directory, basePath),
});

export { sha256sum, versions, send };
