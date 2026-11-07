/**
 * SHA-256 helper exposed to the renderer.
 *
 * Uses Web Crypto instead of `node:crypto`: with `sandbox: true` the preload
 * script cannot load Node built-in modules.
 *
 * @param data - Text (UTF-8 encoded) or bytes to hash
 * @returns Promise resolving to the lowercase hex digest
 */
export async function sha256sum(data: string | ArrayBuffer | ArrayBufferView): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed array (Web Crypto rejects shared buffers).
  const bytes: Uint8Array<ArrayBuffer> =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
