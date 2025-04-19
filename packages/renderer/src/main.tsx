import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import App from "./App.tsx";
import { Patch } from "./types/index.ts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

interface PhraseForm {
  name: string;
  wavPath: string;
  beatsPerMinute: number;
  beatsPerMeasure: number;
  isLoop: boolean;
  isReversed: boolean;
}

interface PatchForm {
  patchName: string;
  directory: string;
  basePath: string;
  rhythmType: string;
  stopMode: string;
  settingsVersion?: string;
  patchID?: string;
  patchOriginID?: string;
  phrases: PhraseForm[];
}

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string>;
      readPatches: (folderPath: string) => Promise<Patch[]>;
      getAudioURL: (wavPath: string) => Promise<string>;
      selectFile: () => Promise<string | null>;
      createPatch: (data: PatchForm) => Promise<void>;
      updatePatch: (data: PatchForm) => Promise<void>;
      deletePatch(directory: string, basePath: string): Promise<void>;
    };
  }
}
