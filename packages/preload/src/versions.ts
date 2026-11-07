/**
 * Runtime versions (electron, chrome, node…) exposed to the renderer.
 *
 * Read from the `process` global that Electron provides to sandboxed preload
 * scripts, not from `node:process`, which a sandboxed preload cannot import.
 */
export const versions: NodeJS.ProcessVersions = { ...globalThis.process.versions };
