import { sha256sum } from "./nodeCrypto.js";
import { versions } from "./versions.js";
import { contextBridge, ipcRenderer } from "electron";

function send(channel: string, message: string) {
  return ipcRenderer.invoke(channel, message);
}

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  readPatches: (folderPath: string) =>
    ipcRenderer.invoke("patches:read", folderPath),
  getAudioURL: (wavPath: string) =>
    ipcRenderer.invoke("phrase:getAudioURL", wavPath),
});

export { sha256sum, versions, send };
