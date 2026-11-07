import { describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertTrustedSender,
  isTrustedRendererUrl,
  UntrustedSenderError,
  type SenderEvent,
} from './trustedSender.js';
import { createTrustedIpcHandle } from './trustedIpc.js';

const devRenderer = new URL('http://localhost:5173/');
const prodIndex = path.resolve(
  '/Applications/JamMan Manager.app/Contents/Resources/app.asar/node_modules/@app/renderer/dist/index.html',
);
const prodRenderer = { path: prodIndex };

const topFrame = (url: string): SenderEvent => ({ senderFrame: { url, parent: null } });

describe('isTrustedRendererUrl', () => {
  it('accepts the dev server origin, on any route', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/', devRenderer)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/some/route?x=1', devRenderer)).toBe(true);
  });

  it('rejects other origins in development', () => {
    expect(isTrustedRendererUrl('http://localhost:5174/', devRenderer)).toBe(false);
    expect(isTrustedRendererUrl('https://evil.example/', devRenderer)).toBe(false);
    expect(isTrustedRendererUrl('file:///index.html', devRenderer)).toBe(false);
  });

  it('accepts the packaged index.html, ignoring hash and query', () => {
    const url = pathToFileURL(prodIndex).href;
    expect(isTrustedRendererUrl(url, prodRenderer)).toBe(true);
    expect(isTrustedRendererUrl(`${url}#/patches`, prodRenderer)).toBe(true);
  });

  it('rejects other file URLs and non-file URLs in production', () => {
    expect(isTrustedRendererUrl('file:///tmp/evil.html', prodRenderer)).toBe(false);
    expect(isTrustedRendererUrl(pathToFileURL(prodIndex + '.evil').href, prodRenderer)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5173/', prodRenderer)).toBe(false);
    expect(isTrustedRendererUrl('not a url', prodRenderer)).toBe(false);
  });
});

describe('assertTrustedSender', () => {
  it('passes for the app page in a top-level frame', () => {
    expect(() =>
      assertTrustedSender(topFrame('http://localhost:5173/'), devRenderer),
    ).not.toThrow();
    expect(() =>
      assertTrustedSender(topFrame(pathToFileURL(prodIndex).href), prodRenderer),
    ).not.toThrow();
  });

  it('throws for an untrusted origin', () => {
    expect(() => assertTrustedSender(topFrame('https://evil.example/'), devRenderer)).toThrow(
      UntrustedSenderError,
    );
  });

  it('throws for a sub-frame, even with the app origin', () => {
    const event: SenderEvent = {
      senderFrame: { url: 'http://localhost:5173/', parent: { url: 'http://localhost:5173/' } },
    };
    expect(() => assertTrustedSender(event, devRenderer)).toThrow(UntrustedSenderError);
  });

  it('throws when the sender frame is gone', () => {
    expect(() => assertTrustedSender({ senderFrame: null }, devRenderer)).toThrow(
      UntrustedSenderError,
    );
    expect(() => assertTrustedSender({} as SenderEvent, devRenderer)).toThrow(UntrustedSenderError);
  });
});

describe('createTrustedIpcHandle', () => {
  function setup() {
    const registered = new Map<string, (event: SenderEvent, ...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, listener: (event: SenderEvent, ...args: unknown[]) => unknown) => {
        registered.set(channel, listener);
      },
    };
    const handle = createTrustedIpcHandle(ipcMain, devRenderer, { warn: () => {} });
    return { registered, handle };
  }

  it('runs the listener with its arguments for a trusted sender', async () => {
    const { registered, handle } = setup();
    const listener = vi.fn((_event: SenderEvent, a: unknown, b: unknown) => `${a}-${b}`);
    handle('patches:read', listener);

    const result = await registered.get('patches:read')!(
      topFrame('http://localhost:5173/'),
      'x',
      'y',
    );
    expect(result).toBe('x-y');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('throws and does not run the operation for an untrusted sender', () => {
    const { registered, handle } = setup();
    const listener = vi.fn();
    handle('patches:delete', listener);

    expect(() =>
      registered.get('patches:delete')!(topFrame('https://evil.example/'), '/sd', 'Patch01'),
    ).toThrow(UntrustedSenderError);
    expect(listener).not.toHaveBeenCalled();
  });
});
