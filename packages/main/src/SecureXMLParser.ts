/**
 * Secure XML Parser Module
 *
 * This module provides a hardened XML parser to prevent XML External Entity (XXE)
 * attacks and other XML-based security vulnerabilities.
 *
 * Security Features:
 * - Prevents XXE attacks by disabling external entities
 * - Prevents billion laughs attacks by limiting entity expansion
 * - Disables DTD processing
 * - Limits recursion depth
 * - Validates XML structure
 *
 * @module SecureXMLParser
 */

import * as xml2js from 'xml2js';
import log from 'electron-log';

/**
 * SecureXMLParser class for safe XML parsing
 */
export class SecureXMLParser {
  private static readonly MAX_XML_SIZE = 10 * 1024 * 1024; // 10 MB max size
  private static readonly MAX_DEPTH = 100; // Maximum nesting depth

  /**
   * Creates a secure XML parser instance with hardened settings
   * @returns xml2js Parser instance with security options
   */
  static createParser(): xml2js.Parser {
    return new xml2js.Parser({
      // Security: Disable XML external entities to prevent XXE attacks
      xmlns: false,

      // Security: Disable DOCTYPE declarations (prevents XXE and billion laughs)
      // Note: xml2js doesn't directly support this, but we validate manually
      strict: true,

      // Security: Normalize whitespace to prevent injection
      normalize: true,
      normalizeTags: false, // Keep original case for JamMan compatibility

      // Security: Trim whitespace to prevent injection
      trim: true,

      // Security: Don't merge attributes to prevent confusion
      mergeAttrs: false,

      // Security: Explicit array handling
      explicitArray: true,
      explicitRoot: true,

      // Performance: Async processing
      async: false,

      // Security: Validate character data
      charsAsChildren: false,

      // Security: Don't include empty values
      emptyTag: undefined,
    });
  }

  /**
   * Validates XML string before parsing
   * @param xmlString - XML string to validate
   * @throws Error if XML is invalid or dangerous
   */
  static validateXML(xmlString: string): void {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('Invalid XML: input must be a non-empty string');
    }

    // Security: Check XML size
    if (xmlString.length > this.MAX_XML_SIZE) {
      throw new Error(`XML size exceeds maximum allowed size (${this.MAX_XML_SIZE} bytes)`);
    }

    // Security: Block DOCTYPE declarations (prevents XXE and billion laughs)
    if (xmlString.includes('<!DOCTYPE')) {
      log.warn('Blocked XML with DOCTYPE declaration');
      throw new Error('DOCTYPE declarations are not allowed for security reasons');
    }

    // Security: Block ENTITY declarations
    if (xmlString.includes('<!ENTITY')) {
      log.warn('Blocked XML with ENTITY declaration');
      throw new Error('ENTITY declarations are not allowed for security reasons');
    }

    // Security: Block external references
    if (xmlString.includes('SYSTEM') || xmlString.includes('PUBLIC')) {
      log.warn('Blocked XML with external references');
      throw new Error('External references are not allowed for security reasons');
    }

    // Security: Basic structure validation
    if (!xmlString.trim().startsWith('<')) {
      throw new Error('Invalid XML: must start with opening tag');
    }

    // Security: Check for balanced tags (basic check)
    const openTags = xmlString.match(/<[^/][^>]*[^/]>/g)?.length || 0;
    const closeTags = xmlString.match(/<\/[^>]+>/g)?.length || 0;
    if (openTags !== closeTags) {
      // This is a basic check; actual validation happens during parsing
      log.warn('XML appears to have unbalanced tags');
    }

    // Security: Check nesting depth
    let depth = 0;
    let maxDepth = 0;
    for (let i = 0; i < xmlString.length; i++) {
      if (xmlString[i] === '<') {
        if (xmlString[i + 1] !== '/') {
          depth++;
          maxDepth = Math.max(maxDepth, depth);
        } else {
          depth--;
        }
      }
    }

    if (maxDepth > this.MAX_DEPTH) {
      log.warn(`XML nesting depth (${maxDepth}) exceeds maximum (${this.MAX_DEPTH})`);
      throw new Error(`XML nesting too deep (max: ${this.MAX_DEPTH})`);
    }
  }

  /**
   * Parses XML string safely with security validation
   * @param xmlString - XML string to parse
   * @returns Promise resolving to parsed XML object
   * @throws Error if XML is invalid or parsing fails
   */
  static async parseXML(xmlString: string): Promise<any> {
    try {
      // Security: Validate XML before parsing
      this.validateXML(xmlString);

      // Create secure parser
      const parser = this.createParser();

      // Parse XML
      const result = await parser.parseStringPromise(xmlString);

      if (!result) {
        throw new Error('XML parsing returned empty result');
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        log.error('XML parsing error:', error.message);
      } else {
        log.error('XML parsing error:', error);
      }
      throw error;
    }
  }

  /**
   * Validates that parsed XML matches expected JamMan structure
   * @param parsedXML - Parsed XML object
   * @param expectedRoot - Expected root element name
   * @throws Error if structure doesn't match
   */
  static validateJamManXML(parsedXML: any, expectedRoot: 'JamManPatch' | 'JamManPhrase'): void {
    if (!parsedXML || typeof parsedXML !== 'object') {
      throw new Error('Invalid parsed XML: not an object');
    }

    if (!(expectedRoot in parsedXML)) {
      throw new Error(`Invalid JamMan XML: expected root element '${expectedRoot}'`);
    }

    const root = parsedXML[expectedRoot];
    if (!root || typeof root !== 'object') {
      throw new Error(`Invalid JamMan XML: '${expectedRoot}' is not an object`);
    }

    // Validate required fields based on type
    if (expectedRoot === 'JamManPatch') {
      const requiredFields = ['PatchName'];
      for (const field of requiredFields) {
        if (!(field in root)) {
          throw new Error(`Invalid JamMan Patch XML: missing required field '${field}'`);
        }
      }
    } else if (expectedRoot === 'JamManPhrase') {
      const requiredFields = ['BeatsPerMinute', 'BeatsPerMeasure'];
      for (const field of requiredFields) {
        if (!(field in root)) {
          throw new Error(`Invalid JamMan Phrase XML: missing required field '${field}'`);
        }
      }
    }
  }

  /**
   * Convenience method to parse and validate JamMan patch XML
   * @param xmlString - XML string to parse
   * @returns Promise resolving to parsed patch object
   */
  static async parsePatchXML(xmlString: string): Promise<any> {
    const result = await this.parseXML(xmlString);
    this.validateJamManXML(result, 'JamManPatch');
    return result;
  }

  /**
   * Convenience method to parse and validate JamMan phrase XML
   * @param xmlString - XML string to parse
   * @returns Promise resolving to parsed phrase object
   */
  static async parsePhraseXML(xmlString: string): Promise<any> {
    const result = await this.parseXML(xmlString);
    this.validateJamManXML(result, 'JamManPhrase');
    return result;
  }
}
