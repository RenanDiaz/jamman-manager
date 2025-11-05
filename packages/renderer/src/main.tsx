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

interface BackupManifest {
  version: string;
  appVersion: string;
  patchCount: number;
  createdAt: string;
  patches: string[];
  playlists?: any;
}

interface BackupInfo {
  valid: boolean;
  manifest?: BackupManifest;
  error?: string;
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
      deletePatchBatch(
        basePath: string,
        directories: string[],
      ): Promise<{ success: boolean; deleted: string[]; failed: number }>;
      reorderPatches(basePath: string, patches: string[]): Promise<void>;
      exportPatchesTXT(patches: Patch[], basePath: string): Promise<ExportResult>;
      exportPatchesPDF(patches: Patch[], basePath: string): Promise<ExportResult>;
      // Backup/Restore
      createBackup(
        basePath: string,
        patches?: string[],
        includePlaylist?: boolean,
      ): Promise<ExportResult>;
      validateBackup(backupPath: string): Promise<BackupInfo>;
      restoreBackup(
        backupPath: string,
        targetPath: string,
        mode: 'replace' | 'merge',
        patches?: string[],
      ): Promise<{ success: boolean; patchesRestored: number }>;
      selectBackupFile(): Promise<string | null>;
    };
  }
}
