import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakePedal } from '../test-utils/fakePedal.js';
import {
  GreenglassClient,
  GreenglassConnectionError,
  GreenglassRequestError,
} from './GreenglassClient.js';
import { MessageID, PropertyID } from './greenglassCodec.js';

const FILE = '/mnt/nandfs/JamManStereo/Patch01/PhraseA/phrase.wav';
const CONTENT = Buffer.from(Array.from({ length: 20_000 }, (_, i) => i % 256));

function setup(options: ConstructorParameters<typeof FakePedal>[0] = {}, timeoutMs = 200) {
  const pedal = new FakePedal({ files: { [FILE]: CONTENT }, ...options });
  const client = new GreenglassClient(pedal.transport, { requestTimeoutMs: timeoutMs });
  return { pedal, client };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GreenglassClient', () => {
  it('identifies the pedal and reads its properties', async () => {
    const { client } = setup();
    expect(await client.whoAmI()).toMatchObject({ familyId: 93, name: 'JamMan Stereo' });
    const props = await client.getProperties();
    expect(props.get(PropertyID.InternalPatchFolderPath)).toBe('/mnt/nandfs/JamManStereo/');
    expect(props.get(PropertyID.RemovableMediaIsPresent)).toBe(1);
  });

  it('reassembles responses that arrive in small chunks', async () => {
    const { client } = setup({ chunkSize: 3 });
    expect((await client.readFile(FILE)).equals(CONTENT)).toBe(true);
  });

  it('reads a whole file in chunks and closes the handle', async () => {
    const { client, pedal } = setup();
    const data = await client.readFile(FILE);
    expect(data.equals(CONTENT)).toBe(true);
    expect(pedal.requests.filter(id => id === MessageID.FileReadRequest).length).toBe(3);
    expect(pedal.openFiles.size).toBe(0);
  });

  it('closes the handle when a read fails', async () => {
    const { client, pedal } = setup();
    pedal.failures.set(MessageID.FileReadRequest, 'I/O error');
    await expect(client.readFile(FILE)).rejects.toThrow('I/O error');
    expect(pedal.openFiles.size).toBe(0);
  });

  it('seeks before reading', async () => {
    const { client } = setup();
    const { handle } = await client.openForRead(FILE);
    await client.seek(handle, 1000);
    expect((await client.read(handle, 10)).equals(CONTENT.subarray(1000, 1010))).toBe(true);
    await client.closeFile(handle);
  });

  it('turns a FailureResponse into a request error and stays usable', async () => {
    const { client } = setup();
    const error = await client.readFile('/missing.wav').catch(e => e);
    expect(error).toBeInstanceOf(GreenglassRequestError);
    expect(error.message).toBe('No such file or directory');
    expect(client.isOpen).toBe(true);
    expect((await client.whoAmI()).name).toBe('JamMan Stereo');
  });

  it('sends one request at a time, in order', async () => {
    const { client, pedal } = setup();
    await Promise.all([client.whoAmI(), client.getProperties(), client.folderContents('/mnt/')]);
    expect(pedal.requests).toEqual([
      MessageID.WhoAmIRequest,
      MessageID.GetPropertiesRequest,
      MessageID.FolderContentsRequest,
    ]);
  });

  it('closes itself when the pedal stops answering', async () => {
    const { client, pedal } = setup({}, 50);
    const closed = vi.fn();
    client.on('close', closed);
    pedal.silent = true;

    await expect(client.whoAmI()).rejects.toBeInstanceOf(GreenglassConnectionError);
    expect(client.isOpen).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
    // Every later request fails at once instead of writing into a desynced stream.
    await expect(client.whoAmI()).rejects.toThrow(/did not answer/);
    expect(pedal.requests).toEqual([MessageID.WhoAmIRequest]);
  });

  it('fails pending requests when the cable is pulled', async () => {
    const { client, pedal } = setup({}, 5000);
    pedal.silent = true;
    const pending = client.whoAmI();
    pedal.unplug();
    await expect(pending).rejects.toThrow('The pedal was disconnected');
    expect(client.isOpen).toBe(false);
  });

  it('emits property notifications', async () => {
    const { client, pedal } = setup();
    const changes: unknown[] = [];
    client.on('property', change => changes.push(change));
    pedal.notifyProperty(PropertyID.RemovableMediaIsPresent, 0);
    await client.whoAmI(); // let the notification arrive
    expect(changes).toEqual([{ property: PropertyID.RemovableMediaIsPresent, value: 0 }]);
  });

  it('closes on corrupt data from the pedal', async () => {
    const pedal = new FakePedal();
    let feed: (chunk: Buffer) => void = () => {};
    const transport = {
      ...pedal.transport,
      onData: (listener: (chunk: Buffer) => void) => {
        feed = listener;
      },
    };
    const client = new GreenglassClient(transport);
    feed(Buffer.from('0100ffffffff', 'hex'));
    expect(client.isOpen).toBe(false);
  });

  it('drops leftovers of an interrupted session before the first request', async () => {
    const pedal = new FakePedal();
    let feed: (chunk: Buffer) => void = () => {};
    const transport = {
      ...pedal.transport,
      onData: (listener: (chunk: Buffer) => void) => {
        feed = listener;
        pedal.transport.onData(listener);
      },
    };
    const client = new GreenglassClient(transport, { requestTimeoutMs: 500 });

    const discarding = client.discardStaleInput({ quietMs: 30 });
    // The tail of an 8 KB FileReadResponse from before: not a valid frame start.
    feed(Buffer.alloc(3000, 0xab));
    await discarding;

    expect(client.isOpen).toBe(true);
    expect((await client.whoAmI()).name).toBe('JamMan Stereo');
  });

  it('lets the request on the wire finish before closing', async () => {
    const pedal = new FakePedal();
    let onWire!: () => void;
    const sent = new Promise<void>(resolve => (onWire = resolve));
    const transport = {
      ...pedal.transport,
      write: async (data: Buffer) => {
        await pedal.transport.write(data);
        onWire();
      },
    };
    const client = new GreenglassClient(transport);

    const who = client.whoAmI();
    await sent; // the request is out, its response not yet delivered
    const closing = client.close();

    // The response still arrives and resolves; closing waits for it.
    await expect(who).resolves.toMatchObject({ name: 'JamMan Stereo' });
    await closing;
    expect(client.isOpen).toBe(false);
    await expect(client.whoAmI()).rejects.toThrow('Connection closed');
  });

  it('refuses requests queued after close() started', async () => {
    const { client, pedal } = setup();
    const reading = client.readFile(FILE);
    await client.close();
    await expect(reading).rejects.toThrow('Connection closed');
    expect(pedal.requests).toEqual([]);
  });
});
