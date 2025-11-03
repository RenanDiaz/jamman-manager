import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import App from './App.tsx';
import { Patch } from './types/index.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
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

interface AudioValidationResult {
  valid: boolean;
  sampleRate?: number;
  bitsPerSample?: number;
  numberOfChannels?: number;
  duration?: number;
  error?: string | null;
  warning?: string;
  canAttemptPlayback?: boolean;
}

interface ExportResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
}

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string>;
      readPatches: (folderPath: string) => Promise<Patch[]>;
      getAudioURL: (wavPath: string) => Promise<string>;
      validateWav: (wavPath: string) => Promise<AudioValidationResult>;
      selectFile: () => Promise<string | null>;
      createPatch: (data: PatchForm) => Promise<void>;
      updatePatch: (data: PatchForm) => Promise<void>;
      deletePatch(basePath: string, directory: string): Promise<void>;
      reorderPatches(basePath: string, patches: string[]): Promise<void>;
      exportPatchesTXT(patches: Patch[], basePath: string): Promise<ExportResult>;
      exportPatchesPDF(patches: Patch[], basePath: string): Promise<ExportResult>;
    };
  }
}
