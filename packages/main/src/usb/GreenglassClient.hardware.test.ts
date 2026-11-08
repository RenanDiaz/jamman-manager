/**
 * Recovering a real JamMan left waiting for the rest of a cut-off request.
 *
 * Skipped unless `JAMMAN_USB=1` (run with --no-file-parallelism next to the
 * other hardware tests). The cut request is a file write to a handle that does
 * not exist, so even once completed it writes nothing.
 */
import { describe, expect, it } from 'vitest';
import { GreenglassClient } from './GreenglassClient.js';
import { encodeRequest, MAX_WRITE_CHUNK, MessageID, PayloadWriter } from './greenglassCodec.js';
import { findJamManPorts, openSerialTransport } from './serialTransport.js';

const enabled = process.env.JAMMAN_USB === '1';

describe.skipIf(!enabled)('GreenglassClient on a real JamMan', () => {
  it('gets back in step after a session that ended mid-frame', async () => {
    const [port] = await findJamManPorts();

    // A session that sends only the first 700 bytes of an 8 KB write, then ends
    const first = await openSerialTransport(port);
    const body = new PayloadWriter()
      .i64(0x7fff_0000n) // no such file handle
      .i32(MAX_WRITE_CHUNK)
      .bytes(Buffer.alloc(MAX_WRITE_CHUNK, 0x55))
      .build();
    await first.write(encodeRequest(MessageID.FileWriteRequest, 4242, body).subarray(0, 700));
    await first.close();

    // A new session: the pedal is still waiting for ~7.5 KB
    const client = new GreenglassClient(await openSerialTransport(port));
    const started = Date.now();
    await client.resync();
    console.log(`resynced in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    expect((await client.whoAmI()).name).toMatch(/JamMan/);
    expect((await client.getProperties()).size).toBeGreaterThan(0);
    await client.close();
  }, 60_000);
});
