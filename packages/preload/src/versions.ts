/**
 * Runtime versions (electron, chrome, node…) exposed to the renderer.
 *
 * Read from the `process` object that Electron passes to sandboxed preload
 * scripts, not from `node:process`, which a sandboxed preload cannot import.
 * It is a parameter of the sandbox wrapper, not a property of `globalThis`, so
 * it must be referenced as a bare `process`.
 */
export const versions: NodeJS.ProcessVersions = { ...process.versions };
