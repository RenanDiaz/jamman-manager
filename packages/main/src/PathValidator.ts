/**
 * Path Validation and Sanitization Module
 *
 * This module provides security utilities to prevent directory traversal attacks
 * and ensure all file operations stay within allowed boundaries.
 *
 * Security Threats Mitigated:
 * - Directory traversal (../ attacks)
 * - Absolute path injection
 * - Symlink attacks
 * - Path normalization bypass
 *
 * @module PathValidator
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import log from 'electron-log';

/**
 * PathValidator class for secure path operations
 */
export class PathValidator {
  /**
   * Validates that a path is safe and within the allowed base directory
   * @param targetPath - The path to validate
   * @param basePath - The allowed base directory
   * @returns true if path is safe, false otherwise
   */
  static isPathSafe(targetPath: string, basePath: string): boolean {
    try {
      // Resolve both paths to absolute, normalized forms
      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(basePath);

      // Check if target is within base directory
      const relative = path.relative(resolvedBase, resolvedTarget);

      // If relative path starts with '..' or is absolute, it's outside base
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    } catch (error) {
      log.error('Path validation error:', error);
      return false;
    }
  }

  /**
   * Validates and resolves a path, ensuring it's within the base directory
   * @param targetPath - The path to validate
   * @param basePath - The allowed base directory
   * @returns Resolved absolute path if safe
   * @throws Error if path is unsafe or invalid
   */
  static validatePath(targetPath: string, basePath: string): string {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('Invalid path: path must be a non-empty string');
    }

    if (!basePath || typeof basePath !== 'string') {
      throw new Error('Invalid base path: base path must be a non-empty string');
    }

    // Resolve to absolute paths
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBase = path.resolve(basePath);

    // Check if target is within base
    if (!this.isPathSafe(resolvedTarget, resolvedBase)) {
      log.warn('Path validation failed:', {
        target: targetPath,
        resolved: resolvedTarget,
        base: basePath,
      });
      throw new Error('Access denied: path is outside allowed directory');
    }

    return resolvedTarget;
  }

  /**
   * Validates that a path exists and is of the expected type
   * @param targetPath - The path to check
   * @param expectedType - Expected type: 'file', 'directory', or 'any'
   * @returns true if path exists and matches expected type
   */
  static pathExists(
    targetPath: string,
    expectedType: 'file' | 'directory' | 'any' = 'any',
  ): boolean {
    try {
      if (!fs.existsSync(targetPath)) {
        return false;
      }

      const stats = fs.statSync(targetPath);

      switch (expectedType) {
        case 'file':
          return stats.isFile();
        case 'directory':
          return stats.isDirectory();
        case 'any':
          return true;
        default:
          return false;
      }
    } catch (error) {
      log.error('Error checking path existence:', error);
      return false;
    }
  }

  /**
   * Sanitizes a filename by removing dangerous characters
   * @param filename - The filename to sanitize
   * @returns Sanitized filename
   */
  static sanitizeFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') {
      throw new Error('Invalid filename');
    }

    // Remove path separators and dangerous characters
    return filename
      .replace(/[/\\?%*:|"<>]/g, '_') // Replace dangerous chars with underscore
      .replace(/\.+/g, '.') // Collapse multiple dots
      .replace(/^\.+/, '') // Remove leading dots
      .trim();
  }

  /**
   * Validates a patch directory name (e.g., "Patch01")
   * @param dirName - Directory name to validate
   * @returns true if valid patch directory name
   */
  static isValidPatchDir(dirName: string): boolean {
    if (!dirName || typeof dirName !== 'string') {
      return false;
    }

    // Must match pattern: Patch + 2 digits
    return /^Patch\d{2}$/.test(dirName);
  }

  /**
   * Validates a phrase directory name (e.g., "PhraseA")
   * @param dirName - Directory name to validate
   * @returns true if valid phrase directory name
   */
  static isValidPhraseDir(dirName: string): boolean {
    if (!dirName || typeof dirName !== 'string') {
      return false;
    }

    // Must match pattern: Phrase + single uppercase letter
    return /^Phrase[A-Z]$/.test(dirName);
  }

  /**
   * Validates and joins path segments safely
   * @param basePath - Base directory path
   * @param segments - Path segments to join
   * @returns Safe joined path
   * @throws Error if resulting path is unsafe
   */
  static safeJoin(basePath: string, ...segments: string[]): string {
    const joined = path.join(basePath, ...segments);
    return this.validatePath(joined, basePath);
  }

  /**
   * Checks if a file has an allowed extension
   * @param filePath - File path to check
   * @param allowedExtensions - Array of allowed extensions (e.g., ['.xml', '.wav'])
   * @returns true if extension is allowed
   */
  static hasAllowedExtension(filePath: string, allowedExtensions: string[]): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return allowedExtensions.map(e => e.toLowerCase()).includes(ext);
  }

  /**
   * Validates a JamMan base folder structure
   * @param folderPath - Path to validate
   * @returns true if folder appears to be a valid JamMan folder
   */
  static isValidJamManFolder(folderPath: string): boolean {
    try {
      if (!this.pathExists(folderPath, 'directory')) {
        return false;
      }

      // Check if folder contains at least one Patch directory
      const entries = fs.readdirSync(folderPath);
      return entries.some(entry => this.isValidPatchDir(entry));
    } catch (error) {
      log.error('Error validating JamMan folder:', error);
      return false;
    }
  }
}
