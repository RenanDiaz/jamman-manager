import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PathValidator } from './PathValidator.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PathValidator', () => {
  describe('isPathSafe', () => {
    it('should accept path within base directory', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = '/Users/test/jamman/Patch01';

      expect(PathValidator.isPathSafe(targetPath, basePath)).toBe(true);
    });

    it('should reject path with directory traversal', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = '/Users/test/jamman/../../../etc/passwd';

      expect(PathValidator.isPathSafe(targetPath, basePath)).toBe(false);
    });

    it('should reject absolute path outside base', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = '/etc/passwd';

      expect(PathValidator.isPathSafe(targetPath, basePath)).toBe(false);
    });

    it('should accept nested paths within base', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = '/Users/test/jamman/Patch01/PhraseA/phrase.wav';

      expect(PathValidator.isPathSafe(targetPath, basePath)).toBe(true);
    });

    it('should handle relative paths correctly', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = path.join(basePath, 'Patch01');

      expect(PathValidator.isPathSafe(targetPath, basePath)).toBe(true);
    });
  });

  describe('validatePath', () => {
    it('should return resolved path for safe path', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = path.join(basePath, 'Patch01');

      const result = PathValidator.validatePath(targetPath, basePath);
      expect(result).toContain('Patch01');
    });

    it('should throw error for unsafe path', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = '/etc/passwd';

      expect(() => PathValidator.validatePath(targetPath, basePath)).toThrow(
        'Access denied: path is outside allowed directory',
      );
    });

    it('should throw error for empty path', () => {
      const basePath = '/Users/test/jamman';

      expect(() => PathValidator.validatePath('', basePath)).toThrow(
        'Invalid path: path must be a non-empty string',
      );
    });

    it('should throw error for non-string path', () => {
      const basePath = '/Users/test/jamman';

      expect(() => PathValidator.validatePath(null as any, basePath)).toThrow(
        'Invalid path: path must be a non-empty string',
      );
    });

    it('should throw error for directory traversal', () => {
      const basePath = '/Users/test/jamman';
      const targetPath = path.join(basePath, '..', '..', 'etc', 'passwd');

      expect(() => PathValidator.validatePath(targetPath, basePath)).toThrow(
        'Access denied: path is outside allowed directory',
      );
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove dangerous characters', () => {
      const filename = 'test<>:"/\\|?*file.wav';
      const sanitized = PathValidator.sanitizeFilename(filename);

      expect(sanitized).toBe('test_________file.wav');
      expect(sanitized).not.toMatch(/[<>:"\/\\|?*]/);
    });

    it('should collapse multiple dots', () => {
      const filename = 'test....file.wav';
      const sanitized = PathValidator.sanitizeFilename(filename);

      expect(sanitized).toBe('test.file.wav');
    });

    it('should remove leading dots', () => {
      const filename = '...test.wav';
      const sanitized = PathValidator.sanitizeFilename(filename);

      expect(sanitized).toBe('test.wav');
    });

    it('should trim whitespace', () => {
      const filename = '  test.wav  ';
      const sanitized = PathValidator.sanitizeFilename(filename);

      expect(sanitized).toBe('test.wav');
    });

    it('should throw error for empty filename', () => {
      expect(() => PathValidator.sanitizeFilename('')).toThrow('Invalid filename');
    });

    it('should throw error for non-string filename', () => {
      expect(() => PathValidator.sanitizeFilename(null as any)).toThrow('Invalid filename');
    });
  });

  describe('isValidPatchDir', () => {
    it('should accept valid patch directory names', () => {
      expect(PathValidator.isValidPatchDir('Patch01')).toBe(true);
      expect(PathValidator.isValidPatchDir('Patch99')).toBe(true);
      expect(PathValidator.isValidPatchDir('Patch00')).toBe(true);
    });

    it('should reject invalid patch directory names', () => {
      expect(PathValidator.isValidPatchDir('Patch1')).toBe(false); // Missing leading zero
      expect(PathValidator.isValidPatchDir('Patch001')).toBe(false); // Too many digits
      expect(PathValidator.isValidPatchDir('patch01')).toBe(false); // Lowercase
      expect(PathValidator.isValidPatchDir('Patch')).toBe(false); // No digits
      expect(PathValidator.isValidPatchDir('Test01')).toBe(false); // Wrong prefix
      expect(PathValidator.isValidPatchDir('')).toBe(false); // Empty
      expect(PathValidator.isValidPatchDir(null as any)).toBe(false); // Null
    });
  });

  describe('isValidPhraseDir', () => {
    it('should accept valid phrase directory names', () => {
      expect(PathValidator.isValidPhraseDir('PhraseA')).toBe(true);
      expect(PathValidator.isValidPhraseDir('PhraseB')).toBe(true);
      expect(PathValidator.isValidPhraseDir('PhraseZ')).toBe(true);
    });

    it('should reject invalid phrase directory names', () => {
      expect(PathValidator.isValidPhraseDir('Phrasea')).toBe(false); // Lowercase
      expect(PathValidator.isValidPhraseDir('PhraseAB')).toBe(false); // Too many letters
      expect(PathValidator.isValidPhraseDir('Phrase1')).toBe(false); // Number instead of letter
      expect(PathValidator.isValidPhraseDir('Phrase')).toBe(false); // No letter
      expect(PathValidator.isValidPhraseDir('phrase A')).toBe(false); // Wrong case
      expect(PathValidator.isValidPhraseDir('')).toBe(false); // Empty
      expect(PathValidator.isValidPhraseDir(null as any)).toBe(false); // Null
    });
  });

  describe('safeJoin', () => {
    it('should join safe paths correctly', () => {
      const basePath = '/Users/test/jamman';
      const result = PathValidator.safeJoin(basePath, 'Patch01', 'PhraseA');

      expect(result).toContain('Patch01');
      expect(result).toContain('PhraseA');
    });

    it('should throw error when result is outside base', () => {
      const basePath = '/Users/test/jamman';

      expect(() => PathValidator.safeJoin(basePath, '..', '..', 'etc', 'passwd')).toThrow(
        'Access denied: path is outside allowed directory',
      );
    });

    it('should handle multiple segments', () => {
      const basePath = '/Users/test/jamman';
      const result = PathValidator.safeJoin(basePath, 'Patch01', 'PhraseA', 'phrase.wav');

      expect(result).toContain('Patch01');
      expect(result).toContain('PhraseA');
      expect(result).toContain('phrase.wav');
    });
  });

  describe('hasAllowedExtension', () => {
    it('should accept allowed extensions', () => {
      expect(PathValidator.hasAllowedExtension('/path/to/file.wav', ['.wav'])).toBe(true);
      expect(PathValidator.hasAllowedExtension('/path/to/file.xml', ['.xml'])).toBe(true);
      expect(PathValidator.hasAllowedExtension('/path/to/file.wav', ['.wav', '.xml'])).toBe(true);
    });

    it('should reject disallowed extensions', () => {
      expect(PathValidator.hasAllowedExtension('/path/to/file.exe', ['.wav'])).toBe(false);
      expect(PathValidator.hasAllowedExtension('/path/to/file.sh', ['.wav', '.xml'])).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(PathValidator.hasAllowedExtension('/path/to/file.WAV', ['.wav'])).toBe(true);
      expect(PathValidator.hasAllowedExtension('/path/to/file.Xml', ['.xml'])).toBe(true);
    });

    it('should handle files without extensions', () => {
      expect(PathValidator.hasAllowedExtension('/path/to/file', ['.wav'])).toBe(false);
    });
  });

  describe('pathExists', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathvalidator-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect existing file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'test');

      expect(PathValidator.pathExists(filePath, 'file')).toBe(true);
      expect(PathValidator.pathExists(filePath, 'any')).toBe(true);
    });

    it('should detect existing directory', () => {
      const dirPath = path.join(tempDir, 'testdir');
      fs.mkdirSync(dirPath);

      expect(PathValidator.pathExists(dirPath, 'directory')).toBe(true);
      expect(PathValidator.pathExists(dirPath, 'any')).toBe(true);
    });

    it('should return false for non-existent path', () => {
      const fakePath = path.join(tempDir, 'nonexistent');

      expect(PathValidator.pathExists(fakePath, 'any')).toBe(false);
      expect(PathValidator.pathExists(fakePath, 'file')).toBe(false);
      expect(PathValidator.pathExists(fakePath, 'directory')).toBe(false);
    });

    it('should return false when type does not match', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'test');

      expect(PathValidator.pathExists(filePath, 'directory')).toBe(false);
    });
  });

  describe('isValidJamManFolder', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamman-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should accept folder with valid patch directories', () => {
      fs.mkdirSync(path.join(tempDir, 'Patch01'));
      fs.mkdirSync(path.join(tempDir, 'Patch02'));

      expect(PathValidator.isValidJamManFolder(tempDir)).toBe(true);
    });

    it('should reject folder without patch directories', () => {
      fs.mkdirSync(path.join(tempDir, 'SomeOtherDir'));

      expect(PathValidator.isValidJamManFolder(tempDir)).toBe(false);
    });

    it('should reject non-existent folder', () => {
      const fakePath = path.join(tempDir, 'nonexistent');

      expect(PathValidator.isValidJamManFolder(fakePath)).toBe(false);
    });

    it('should accept folder with at least one patch directory', () => {
      fs.mkdirSync(path.join(tempDir, 'Patch01'));
      fs.mkdirSync(path.join(tempDir, 'OtherDir'));

      expect(PathValidator.isValidJamManFolder(tempDir)).toBe(true);
    });
  });
});
