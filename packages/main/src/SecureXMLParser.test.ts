import { describe, it, expect, vi } from 'vitest';
import { SecureXMLParser } from './SecureXMLParser.js';

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SecureXMLParser', () => {
  describe('validateXML', () => {
    it('should accept valid XML', () => {
      const validXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPatch>
  <PatchName>Test</PatchName>
</JamManPatch>`;

      expect(() => SecureXMLParser.validateXML(validXML)).not.toThrow();
    });

    it('should reject empty XML', () => {
      expect(() => SecureXMLParser.validateXML('')).toThrow(
        'Invalid XML: input must be a non-empty string',
      );
    });

    it('should reject non-string input', () => {
      expect(() => SecureXMLParser.validateXML(null as any)).toThrow(
        'Invalid XML: input must be a non-empty string',
      );
    });

    it('should reject XML with DOCTYPE declaration', () => {
      const xmlWithDoctype = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<JamManPatch>
  <PatchName>&xxe;</PatchName>
</JamManPatch>`;

      expect(() => SecureXMLParser.validateXML(xmlWithDoctype)).toThrow(
        'DOCTYPE declarations are not allowed for security reasons',
      );
    });

    it('should reject XML with ENTITY declaration', () => {
      const xmlWithEntity = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe "malicious content">
]>
<root></root>`;

      expect(() => SecureXMLParser.validateXML(xmlWithEntity)).toThrow(
        'DOCTYPE declarations are not allowed for security reasons',
      );
    });

    it('should reject XML with SYSTEM reference', () => {
      const xmlWithSystem = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo SYSTEM "http://evil.com/xxe.dtd">
<root></root>`;

      expect(() => SecureXMLParser.validateXML(xmlWithSystem)).toThrow(
        'DOCTYPE declarations are not allowed for security reasons',
      );
    });

    it('should reject XML with PUBLIC reference', () => {
      const xmlWithPublic = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo PUBLIC "-//Example//DTD//EN" "http://evil.com/xxe.dtd">
<root></root>`;

      expect(() => SecureXMLParser.validateXML(xmlWithPublic)).toThrow(
        'DOCTYPE declarations are not allowed for security reasons',
      );
    });

    it('should reject XML exceeding size limit', () => {
      const largeXML = '<root>' + 'a'.repeat(11 * 1024 * 1024) + '</root>';

      expect(() => SecureXMLParser.validateXML(largeXML)).toThrow(
        'XML size exceeds maximum allowed size',
      );
    });

    it('should reject XML exceeding depth limit', () => {
      let deepXML = '';
      for (let i = 0; i < 150; i++) {
        deepXML += '<level>';
      }
      deepXML += 'content';
      for (let i = 0; i < 150; i++) {
        deepXML += '</level>';
      }

      expect(() => SecureXMLParser.validateXML(deepXML)).toThrow('XML nesting too deep');
    });

    it('should accept XML with reasonable depth', () => {
      let reasonableXML = '<root>';
      for (let i = 0; i < 50; i++) {
        reasonableXML += '<level>';
      }
      reasonableXML += 'content';
      for (let i = 0; i < 50; i++) {
        reasonableXML += '</level>';
      }
      reasonableXML += '</root>';

      expect(() => SecureXMLParser.validateXML(reasonableXML)).not.toThrow();
    });

    it('should reject XML not starting with tag', () => {
      const invalidXML = 'This is not XML';

      expect(() => SecureXMLParser.validateXML(invalidXML)).toThrow(
        'Invalid XML: must start with opening tag',
      );
    });
  });

  describe('parseXML', () => {
    it('should parse valid XML', async () => {
      const validXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPatch>
  <PatchName>Test Patch</PatchName>
  <RhythmType>0</RhythmType>
</JamManPatch>`;

      const result = await SecureXMLParser.parseXML(validXML);

      expect(result).toBeDefined();
      expect(result.JamManPatch).toBeDefined();
      expect(result.JamManPatch.PatchName[0]).toBe('Test Patch');
      expect(result.JamManPatch.RhythmType[0]).toBe('0');
    });

    it('should reject invalid XML structure', async () => {
      const invalidXML = '<root><unclosed>';

      await expect(SecureXMLParser.parseXML(invalidXML)).rejects.toThrow();
    });

    it('should reject empty result', async () => {
      const emptyXML = '';

      await expect(SecureXMLParser.parseXML(emptyXML)).rejects.toThrow();
    });

    it('should handle XML with special characters', async () => {
      const xmlWithSpecial = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPatch>
  <PatchName>Test &amp; Special &lt;Characters&gt;</PatchName>
</JamManPatch>`;

      const result = await SecureXMLParser.parseXML(xmlWithSpecial);

      expect(result.JamManPatch.PatchName[0]).toBe('Test & Special <Characters>');
    });
  });

  describe('validateJamManXML', () => {
    describe('JamManPatch validation', () => {
      it('should accept valid patch XML', () => {
        const validPatch = {
          JamManPatch: {
            PatchName: ['Test'],
            RhythmType: ['0'],
            StopMode: ['0'],
          },
        };

        expect(() => SecureXMLParser.validateJamManXML(validPatch, 'JamManPatch')).not.toThrow();
      });

      it('should reject patch XML missing PatchName', () => {
        const invalidPatch = {
          JamManPatch: {
            RhythmType: ['0'],
            StopMode: ['0'],
          },
        };

        expect(() => SecureXMLParser.validateJamManXML(invalidPatch, 'JamManPatch')).toThrow(
          "Invalid JamMan Patch XML: missing required field 'PatchName'",
        );
      });

      it('should reject patch XML missing root element', () => {
        const invalidPatch = {
          SomeOtherRoot: {
            PatchName: ['Test'],
          },
        };

        expect(() => SecureXMLParser.validateJamManXML(invalidPatch, 'JamManPatch')).toThrow(
          "Invalid JamMan XML: expected root element 'JamManPatch'",
        );
      });

      it('should reject non-object patch XML', () => {
        expect(() => SecureXMLParser.validateJamManXML(null, 'JamManPatch')).toThrow(
          'Invalid parsed XML: not an object',
        );
      });
    });

    describe('JamManPhrase validation', () => {
      it('should accept valid phrase XML', () => {
        const validPhrase = {
          JamManPhrase: {
            BeatsPerMinute: ['120'],
            BeatsPerMeasure: ['4'],
            ID: ['test-id'],
          },
        };

        expect(() => SecureXMLParser.validateJamManXML(validPhrase, 'JamManPhrase')).not.toThrow();
      });

      it('should reject phrase XML missing BeatsPerMinute', () => {
        const invalidPhrase = {
          JamManPhrase: {
            BeatsPerMeasure: ['4'],
          },
        };

        expect(() => SecureXMLParser.validateJamManXML(invalidPhrase, 'JamManPhrase')).toThrow(
          "Invalid JamMan Phrase XML: missing required field 'BeatsPerMinute'",
        );
      });

      it('should reject phrase XML missing BeatsPerMeasure', () => {
        const invalidPhrase = {
          JamManPhrase: {
            BeatsPerMinute: ['120'],
          },
        };

        expect(() => SecureXMLParser.validateJamManXML(invalidPhrase, 'JamManPhrase')).toThrow(
          "Invalid JamMan Phrase XML: missing required field 'BeatsPerMeasure'",
        );
      });
    });
  });

  describe('parsePatchXML', () => {
    it('should parse and validate patch XML', async () => {
      const validPatchXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPatch>
  <PatchName>Test Patch</PatchName>
  <RhythmType>0</RhythmType>
  <StopMode>0</StopMode>
</JamManPatch>`;

      const result = await SecureXMLParser.parsePatchXML(validPatchXML);

      expect(result.JamManPatch).toBeDefined();
      expect(result.JamManPatch.PatchName[0]).toBe('Test Patch');
    });

    it('should reject invalid patch XML structure', async () => {
      const invalidXML = `<?xml version="1.0" encoding="UTF-8"?>
<WrongRoot>
  <PatchName>Test</PatchName>
</WrongRoot>`;

      await expect(SecureXMLParser.parsePatchXML(invalidXML)).rejects.toThrow(
        "Invalid JamMan XML: expected root element 'JamManPatch'",
      );
    });

    it('should reject patch XML missing required fields', async () => {
      const invalidXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPatch>
  <RhythmType>0</RhythmType>
</JamManPatch>`;

      await expect(SecureXMLParser.parsePatchXML(invalidXML)).rejects.toThrow(
        "Invalid JamMan Patch XML: missing required field 'PatchName'",
      );
    });
  });

  describe('parsePhraseXML', () => {
    it('should parse and validate phrase XML', async () => {
      const validPhraseXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPhrase>
  <BeatsPerMinute>120</BeatsPerMinute>
  <BeatsPerMeasure>4</BeatsPerMeasure>
  <ID>test-id</ID>
</JamManPhrase>`;

      const result = await SecureXMLParser.parsePhraseXML(validPhraseXML);

      expect(result.JamManPhrase).toBeDefined();
      expect(result.JamManPhrase.BeatsPerMinute[0]).toBe('120');
      expect(result.JamManPhrase.BeatsPerMeasure[0]).toBe('4');
    });

    it('should reject invalid phrase XML structure', async () => {
      const invalidXML = `<?xml version="1.0" encoding="UTF-8"?>
<WrongRoot>
  <BeatsPerMinute>120</BeatsPerMinute>
</WrongRoot>`;

      await expect(SecureXMLParser.parsePhraseXML(invalidXML)).rejects.toThrow(
        "Invalid JamMan XML: expected root element 'JamManPhrase'",
      );
    });

    it('should reject phrase XML missing required fields', async () => {
      const invalidXML = `<?xml version="1.0" encoding="UTF-8"?>
<JamManPhrase>
  <BeatsPerMinute>120</BeatsPerMinute>
</JamManPhrase>`;

      await expect(SecureXMLParser.parsePhraseXML(invalidXML)).rejects.toThrow(
        "Invalid JamMan Phrase XML: missing required field 'BeatsPerMeasure'",
      );
    });
  });

  describe('Security: XXE Prevention', () => {
    it('should block XXE attack with SYSTEM entity', async () => {
      const xxeAttempt = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<JamManPatch>
  <PatchName>&xxe;</PatchName>
</JamManPatch>`;

      await expect(SecureXMLParser.parsePatchXML(xxeAttempt)).rejects.toThrow(
        'DOCTYPE declarations are not allowed for security reasons',
      );
    });

    it('should block billion laughs attack', async () => {
      const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<JamManPatch>
  <PatchName>&lol3;</PatchName>
</JamManPatch>`;

      await expect(SecureXMLParser.parsePatchXML(billionLaughs)).rejects.toThrow(
        'DOCTYPE declarations are not allowed for security reasons',
      );
    });

    it('should block external entity references', async () => {
      const externalEntity = `<?xml version="1.0"?>
<!DOCTYPE foo SYSTEM "http://evil.com/evil.dtd">
<JamManPatch>
  <PatchName>Test</PatchName>
</JamManPatch>`;

      await expect(SecureXMLParser.parsePatchXML(externalEntity)).rejects.toThrow(
        'DOCTYPE declarations are not allowed for security reasons',
      );
    });
  });
});
