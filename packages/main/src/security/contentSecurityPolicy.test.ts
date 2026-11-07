import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  installContentSecurityPolicy,
} from './contentSecurityPolicy.js';

function directive(policy: string, name: string) {
  return policy
    .split(';')
    .map(d => d.trim())
    .find(d => d.startsWith(`${name} `));
}

describe('buildContentSecurityPolicy', () => {
  it('blocks inline scripts in production and allows jamman: media', () => {
    const policy = buildContentSecurityPolicy();
    expect(directive(policy, 'script-src')).toBe("script-src 'self'");
    expect(directive(policy, 'media-src')).toBe("media-src 'self' jamman:");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(policy).not.toContain('localhost');
  });

  it('adds only what the Vite dev server needs in development', () => {
    const policy = buildContentSecurityPolicy({ devServerOrigin: 'http://localhost:5173' });
    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' ws://localhost:5173");
  });
});

describe('installContentSecurityPolicy', () => {
  type Listener = Parameters<
    Parameters<typeof installContentSecurityPolicy>[0]['webRequest']['onHeadersReceived']
  >[0];

  function run(resourceType: string, responseHeaders: Record<string, string[]>) {
    let listener: Listener | undefined;
    installContentSecurityPolicy({ webRequest: { onHeadersReceived: l => (listener = l) } });
    let result: Record<string, string[] | string> | undefined;
    listener!({ resourceType, responseHeaders }, r => (result = r.responseHeaders));
    return result!;
  }

  it('replaces any CSP on documents', () => {
    const headers = run('mainFrame', {
      'content-security-policy': ['default-src *'],
      'x-a': ['1'],
    });
    expect(headers['content-security-policy']).toBeUndefined();
    expect(headers['Content-Security-Policy']).toEqual([buildContentSecurityPolicy()]);
    expect(headers['x-a']).toEqual(['1']);
  });

  it('leaves non-document responses untouched', () => {
    const headers = run('media', { 'content-type': ['audio/wav'] });
    expect(headers).toEqual({ 'content-type': ['audio/wav'] });
  });
});
