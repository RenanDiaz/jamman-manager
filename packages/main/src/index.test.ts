import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';
import * as xml2js from 'xml2js';

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(() => Promise.resolve()),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  protocol: {
    registerFileProtocol: vi.fn(),
  },
}));

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('XML Parsing', () => {
  describe('Patch XML Generation', () => {
    it('should generate valid patch XML structure', () => {
      const patchXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>Test Patch</PatchName>
  <RhythmType>0</RhythmType>
  <StopMode>0</StopMode>
  <SettingsVersion>1</SettingsVersion>
  <ID>test-id</ID>
  <OriginID>test-origin-id</OriginID>
  <Metadata/>
</JamManPatch>`.trim();

      const parser = new xml2js.Parser();
      return parser.parseStringPromise(patchXml).then(result => {
        expect(result.JamManPatch).toBeDefined();
        expect(result.JamManPatch.PatchName[0]).toBe('Test Patch');
        expect(result.JamManPatch.$).toEqual({
          xmlns: 'http://schemas.digitech.com/JamMan/Patch',
          device: 'JamManStereo',
          version: '1',
        });
      });
    });

    it('should handle special characters in patch name', () => {
      const patchXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPatch xmlns="http://schemas.digitech.com/JamMan/Patch" device="JamManStereo" version="1">
  <PatchName>Test &amp; Special &lt;Characters&gt;</PatchName>
  <RhythmType>0</RhythmType>
  <StopMode>0</StopMode>
  <SettingsVersion>1</SettingsVersion>
  <ID>test-id</ID>
  <OriginID>test-origin-id</OriginID>
  <Metadata/>
</JamManPatch>`.trim();

      const parser = new xml2js.Parser();
      return parser.parseStringPromise(patchXml).then(result => {
        expect(result.JamManPatch.PatchName[0]).toBe('Test & Special <Characters>');
      });
    });
  });

  describe('Phrase XML Generation', () => {
    it('should generate valid phrase XML structure', () => {
      const phraseXml = `
<?xml version="1.0" encoding="UTF-8" ?>
<JamManPhrase xmlns="http://schemas.digitech.com/JamMan/Phrase" version="1">
  <BeatsPerMinute>120</BeatsPerMinute>
  <BeatsPerMeasure>4</BeatsPerMeasure>
  <BpmValidated>0</BpmValidated>
  <IsLoop>1</IsLoop>
  <IsReversed>0</IsReversed>
  <SettingsVersion>1</SettingsVersion>
  <AudioVersion>1</AudioVersion>
  <ID>phrase-id</ID>
  <OriginID>phrase-origin-id</OriginID>
  <Metadata/>
</JamManPhrase>`.trim();

      const parser = new xml2js.Parser();
      return parser.parseStringPromise(phraseXml).then(result => {
        expect(result.JamManPhrase).toBeDefined();
        expect(result.JamManPhrase.BeatsPerMinute[0]).toBe('120');
        expect(result.JamManPhrase.BeatsPerMeasure[0]).toBe('4');
        expect(result.JamManPhrase.IsLoop[0]).toBe('1');
        expect(result.JamManPhrase.IsReversed[0]).toBe('0');
      });
    });

    it('should correctly represent boolean values as 0 and 1', () => {
      const phraseXmlLoop = `<JamManPhrase><IsLoop>1</IsLoop></JamManPhrase>`;
      const phraseXmlNoLoop = `<JamManPhrase><IsLoop>0</IsLoop></JamManPhrase>`;

      const parser = new xml2js.Parser();

      return Promise.all([
        parser.parseStringPromise(phraseXmlLoop),
        parser.parseStringPromise(phraseXmlNoLoop),
      ]).then(([resultLoop, resultNoLoop]) => {
        expect(resultLoop.JamManPhrase.IsLoop[0]).toBe('1');
        expect(resultNoLoop.JamManPhrase.IsLoop[0]).toBe('0');
      });
    });
  });

  describe('XML Parsing Error Handling', () => {
    it('should handle invalid XML gracefully', async () => {
      const invalidXml = '<JamManPatch><PatchName>Unclosed tag';
      const parser = new xml2js.Parser();

      await expect(parser.parseStringPromise(invalidXml)).rejects.toThrow();
    });

    it('should handle empty XML', async () => {
      const emptyXml = '';
      const parser = new xml2js.Parser();

      // xml2js returns null for empty strings instead of throwing
      const result = await parser.parseStringPromise(emptyXml);
      expect(result).toBeNull();
    });
  });
});

describe('File Operations', () => {
  const testDir = path.join(process.cwd(), '__test_data__');
  const patchDir = path.join(testDir, 'Patch01');

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fse.removeSync(testDir);
    }
    fse.ensureDirSync(testDir);
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fse.removeSync(testDir);
    }
  });

  describe('Directory Operations', () => {
    it('should create directory structure', () => {
      fse.ensureDirSync(patchDir);
      expect(fs.existsSync(patchDir)).toBe(true);
      expect(fs.statSync(patchDir).isDirectory()).toBe(true);
    });

    it('should handle nested directory creation', () => {
      const phraseDir = path.join(patchDir, 'PhraseA');
      fse.ensureDirSync(phraseDir);

      expect(fs.existsSync(patchDir)).toBe(true);
      expect(fs.existsSync(phraseDir)).toBe(true);
    });

    it('should safely remove directories', () => {
      fse.ensureDirSync(patchDir);
      fse.removeSync(patchDir);

      expect(fs.existsSync(patchDir)).toBe(false);
    });
  });

  describe('File Copy Operations', () => {
    it('should copy files correctly', () => {
      const sourceFile = path.join(testDir, 'source.txt');
      const destFile = path.join(patchDir, 'dest.txt');

      fs.writeFileSync(sourceFile, 'test content');
      fse.ensureDirSync(patchDir);
      fs.copyFileSync(sourceFile, destFile);

      expect(fs.existsSync(destFile)).toBe(true);
      expect(fs.readFileSync(destFile, 'utf-8')).toBe('test content');
    });

    it('should throw error when copying non-existent file', () => {
      const nonExistentFile = path.join(testDir, 'nonexistent.txt');
      const destFile = path.join(patchDir, 'dest.txt');

      fse.ensureDirSync(patchDir);

      expect(() => {
        fs.copyFileSync(nonExistentFile, destFile);
      }).toThrow();
    });
  });

  describe('Backup and Restore', () => {
    it('should create backup copy of directory', () => {
      fse.ensureDirSync(patchDir);
      fs.writeFileSync(path.join(patchDir, 'patch.xml'), '<xml>content</xml>');

      const backupDir = path.join(testDir, 'Patch01_backup');
      fse.copySync(patchDir, backupDir);

      expect(fs.existsSync(backupDir)).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'patch.xml'))).toBe(true);
    });

    it('should restore from backup', () => {
      fse.ensureDirSync(patchDir);
      fs.writeFileSync(path.join(patchDir, 'patch.xml'), 'original');

      const backupDir = path.join(testDir, 'Patch01_backup');
      fse.copySync(patchDir, backupDir);

      // Modify original
      fs.writeFileSync(path.join(patchDir, 'patch.xml'), 'modified');

      // Restore from backup
      fse.removeSync(patchDir);
      fse.moveSync(backupDir, patchDir);

      expect(fs.readFileSync(path.join(patchDir, 'patch.xml'), 'utf-8')).toBe('original');
    });
  });
});

describe('Validation Logic', () => {
  describe('Path Validation', () => {
    it('should detect existing paths', () => {
      const existingPath = process.cwd();
      expect(fs.existsSync(existingPath)).toBe(true);
    });

    it('should detect non-existing paths', () => {
      const nonExistentPath = '/nonexistent/path/to/nowhere';
      expect(fs.existsSync(nonExistentPath)).toBe(false);
    });

    it('should correctly identify directories vs files', () => {
      const dirPath = process.cwd();
      const filePath = __filename;

      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
      expect(fs.statSync(filePath).isFile()).toBe(true);
    });
  });

  describe('Patch Name Validation', () => {
    it('should validate patch directory name format', () => {
      const validNames = ['Patch01', 'Patch02', 'Patch99'];
      const invalidNames = ['Patch1', 'Patch100', 'patch01'];

      validNames.forEach(name => {
        expect(/^Patch\d{2}$/.test(name)).toBe(true);
      });

      invalidNames.forEach(name => {
        expect(/^Patch\d{2}$/.test(name)).toBe(false);
      });
    });

    it('should validate patch numbers are in valid range (01-99)', () => {
      const isValidPatchNumber = (name: string) => {
        const match = name.match(/^Patch(\d{2})$/);
        if (!match) return false;
        const num = parseInt(match[1], 10);
        return num >= 1 && num <= 99;
      };

      expect(isValidPatchNumber('Patch00')).toBe(false);
      expect(isValidPatchNumber('Patch01')).toBe(true);
      expect(isValidPatchNumber('Patch99')).toBe(true);
    });

    it('should validate phrase directory name format', () => {
      const validNames = ['PhraseA', 'PhraseB', 'PhraseZ'];
      const invalidNames = ['Phrase1', 'phrase', 'PhraseAA', 'Phrase'];

      validNames.forEach(name => {
        expect(/^Phrase[A-Z]$/.test(name)).toBe(true);
      });

      invalidNames.forEach(name => {
        expect(/^Phrase[A-Z]$/.test(name)).toBe(false);
      });
    });
  });
});
