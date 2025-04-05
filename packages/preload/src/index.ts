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
});

export { sha256sum, versions, send };
