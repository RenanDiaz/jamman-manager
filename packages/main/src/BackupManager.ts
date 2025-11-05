import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';

export interface BackupManifest {
  version: string;
  appVersion: string;
  patchCount: number;
  createdAt: string;
  patches: string[];
  playlists?: any;
}

export interface BackupOptions {
  basePath: string;
  outputPath: string;
  patches?: string[]; // If not provided, backup all patches
  includePlaylist?: boolean;
}

export interface RestoreOptions {
  backupPath: string;
  targetPath: string;
  mode: 'replace' | 'merge';
  patches?: string[]; // If not provided, restore all patches
}

export interface BackupInfo {
  valid: boolean;
  manifest?: BackupManifest;
  error?: string;
}

export class BackupManager {
  /**
   * Creates a backup of patches in ZIP format
   */
  static async createBackup(options: BackupOptions): Promise<string> {
    const { basePath, outputPath, patches, includePlaylist = false } = options;

    // Validate base path exists
    if (!fs.existsSync(basePath)) {
      throw new Error(`Base path does not exist: ${basePath}`);
    }

    // Get all patches to backup
    const allPatches = fs.readdirSync(basePath).filter(file => {
      const fullPath = path.join(basePath, file);
      return (
        fs.statSync(fullPath).isDirectory() &&
        file.startsWith('Patch') &&
        fs.existsSync(path.join(fullPath, 'patch.xml'))
      );
    });

    const patchesToBackup = patches && patches.length > 0 ? patches : allPatches;

    if (patchesToBackup.length === 0) {
      throw new Error('No patches found to backup');
    }

    // Create ZIP archive
    const zip = new AdmZip();

    // Create manifest
    const manifest: BackupManifest = {
      version: '1.0',
      appVersion: '0.1.0', // TODO: Get from package.json
      patchCount: patchesToBackup.length,
      createdAt: new Date().toISOString(),
      patches: patchesToBackup,
      playlists: null,
    };

    // Add manifest.json
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    // Add README.txt
    const readme = this.generateReadme(manifest);
    zip.addFile('README.txt', Buffer.from(readme, 'utf-8'));

    // Add each patch directory
    for (const patchDir of patchesToBackup) {
      const patchPath = path.join(basePath, patchDir);
      if (!fs.existsSync(patchPath)) {
        console.warn(`Patch directory not found, skipping: ${patchDir}`);
        continue;
      }

      // Add patch.xml
      const patchXmlPath = path.join(patchPath, 'patch.xml');
      if (fs.existsSync(patchXmlPath)) {
        const patchXmlContent = fs.readFileSync(patchXmlPath);
        zip.addFile(`${patchDir}/patch.xml`, patchXmlContent);
      }

      // Add all phrase directories
      const phraseDirs = fs.readdirSync(patchPath).filter(file => {
        const fullPath = path.join(patchPath, file);
        return fs.statSync(fullPath).isDirectory() && file.startsWith('Phrase');
      });

      for (const phraseDir of phraseDirs) {
        const phrasePath = path.join(patchPath, phraseDir);

        // Add phrase.xml
        const phraseXmlPath = path.join(phrasePath, 'phrase.xml');
        if (fs.existsSync(phraseXmlPath)) {
          const phraseXmlContent = fs.readFileSync(phraseXmlPath);
          zip.addFile(`${patchDir}/${phraseDir}/phrase.xml`, phraseXmlContent);
        }

        // Add phrase.wav
        const phraseWavPath = path.join(phrasePath, 'phrase.wav');
        if (fs.existsSync(phraseWavPath)) {
          const phraseWavContent = fs.readFileSync(phraseWavPath);
          zip.addFile(`${patchDir}/${phraseDir}/phrase.wav`, phraseWavContent);
        }
      }
    }

    // Add playlists.json if requested and exists
    if (includePlaylist) {
      const playlistPath = path.join(basePath, '.jamman-playlists.json');
      if (fs.existsSync(playlistPath)) {
        const playlistContent = fs.readFileSync(playlistPath);
        zip.addFile('playlists.json', playlistContent);
        manifest.playlists = JSON.parse(playlistContent.toString());
      }
    }

    // Write ZIP to output path
    zip.writeZip(outputPath);

    return outputPath;
  }

  /**
   * Validates and reads a backup file
   */
  static async validateBackup(backupPath: string): Promise<BackupInfo> {
    try {
      if (!fs.existsSync(backupPath)) {
        return { valid: false, error: 'Backup file not found' };
      }

      const zip = new AdmZip(backupPath);
      const zipEntries = zip.getEntries();

      // Check for manifest.json
      const manifestEntry = zipEntries.find(entry => entry.entryName === 'manifest.json');
      if (!manifestEntry) {
        return { valid: false, error: 'Invalid backup: manifest.json not found' };
      }

      const manifestContent = manifestEntry.getData().toString('utf-8');
      const manifest: BackupManifest = JSON.parse(manifestContent);

      // Validate manifest structure
      if (!manifest.version || !manifest.patchCount || !manifest.patches) {
        return { valid: false, error: 'Invalid manifest structure' };
      }

      // Verify patches exist in ZIP
      for (const patchDir of manifest.patches) {
        const patchXmlEntry = zipEntries.find(entry => entry.entryName === `${patchDir}/patch.xml`);
        if (!patchXmlEntry) {
          return { valid: false, error: `Missing patch.xml for ${patchDir}` };
        }
      }

      return { valid: true, manifest };
    } catch (error) {
      return {
        valid: false,
        error: `Failed to validate backup: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Restores a backup to the target path
   */
  static async restoreBackup(
    options: RestoreOptions,
  ): Promise<{ success: boolean; patchesRestored: number }> {
    const { backupPath, targetPath, mode, patches } = options;

    // Validate backup
    const validation = await this.validateBackup(backupPath);
    if (!validation.valid || !validation.manifest) {
      throw new Error(validation.error || 'Invalid backup');
    }

    const manifest = validation.manifest;

    // Ensure target path exists
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // Determine which patches to restore
    const patchesToRestore = patches && patches.length > 0 ? patches : manifest.patches;

    // Replace mode: clear existing patches first
    if (mode === 'replace') {
      const existingPatches = fs.readdirSync(targetPath).filter(file => {
        const fullPath = path.join(targetPath, file);
        return (
          fs.statSync(fullPath).isDirectory() &&
          file.startsWith('Patch') &&
          fs.existsSync(path.join(fullPath, 'patch.xml'))
        );
      });

      // Remove existing patches
      for (const patchDir of existingPatches) {
        const patchPath = path.join(targetPath, patchDir);
        fse.removeSync(patchPath);
      }
    }

    // Extract patches from ZIP
    const zip = new AdmZip(backupPath);
    let patchesRestored = 0;

    for (const patchDir of patchesToRestore) {
      try {
        // In merge mode, check if patch already exists and find next available number
        let targetPatchDir = patchDir;
        if (mode === 'merge') {
          const patchPath = path.join(targetPath, patchDir);
          if (fs.existsSync(patchPath)) {
            // Find next available patch number
            const patchNumber = parseInt(patchDir.replace('Patch', ''), 10);
            let nextNumber = patchNumber + 1;
            while (
              fs.existsSync(path.join(targetPath, `Patch${String(nextNumber).padStart(2, '0')}`))
            ) {
              nextNumber++;
            }
            targetPatchDir = `Patch${String(nextNumber).padStart(2, '0')}`;
            console.log(`Patch ${patchDir} already exists, restoring as ${targetPatchDir}`);
          }
        }

        // Extract all files for this patch
        const patchEntries = zip
          .getEntries()
          .filter(entry => entry.entryName.startsWith(`${patchDir}/`));

        for (const entry of patchEntries) {
          if (entry.isDirectory) continue;

          // Replace original patch dir with target patch dir in the path
          const relativePath = entry.entryName.replace(patchDir, targetPatchDir);
          const outputPath = path.join(targetPath, relativePath);

          // Ensure directory exists
          const dirPath = path.dirname(outputPath);
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }

          // Write file
          fs.writeFileSync(outputPath, entry.getData());
        }

        patchesRestored++;
      } catch (error) {
        console.error(`Failed to restore patch ${patchDir}:`, error);
      }
    }

    // Restore playlists.json if it exists in backup
    try {
      const playlistEntry = zip.getEntry('playlists.json');
      if (playlistEntry) {
        const playlistPath = path.join(targetPath, '.jamman-playlists.json');
        fs.writeFileSync(playlistPath, playlistEntry.getData());
      }
    } catch (error) {
      console.warn('Failed to restore playlists.json:', error);
    }

    return { success: true, patchesRestored };
  }

  /**
   * Generates README content for the backup
   */
  private static generateReadme(manifest: BackupManifest): string {
    return `JamMan Manager Backup
=====================

Backup Information:
- Created: ${new Date(manifest.createdAt).toLocaleString()}
- Patch Count: ${manifest.patchCount}
- App Version: ${manifest.appVersion}
- Backup Format Version: ${manifest.version}

Structure:
----------
This backup contains JamMan patches in the original directory structure:

/
├── README.txt (this file)
├── manifest.json (backup metadata)
├── playlists.json (optional: playlist data)
├── Patch01/
│   ├── patch.xml (patch configuration)
│   └── PhraseA/
│       ├── phrase.xml (phrase configuration)
│       └── phrase.wav (audio file)
├── Patch02/
...

Patches included in this backup:
${manifest.patches.map(p => `  - ${p}`).join('\n')}

Restoring:
----------
Use JamMan Manager to restore this backup:
1. Open JamMan Manager
2. Click "Restore Backup"
3. Select this ZIP file
4. Choose restore mode:
   - Replace All: Removes existing patches and restores backup
   - Merge: Adds backup patches to existing ones (renumbers if needed)

Manual Extraction:
------------------
You can manually extract this ZIP file to access individual patches.
Each patch folder can be copied directly to your JamMan SD card.

Generated by JamMan Manager
https://github.com/yourusername/jamman-manager
`;
  }
}
