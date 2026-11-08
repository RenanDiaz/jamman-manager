/**
 * Serial-port transport for the JamMan, on top of the `serialport` package.
 *
 * The pedal is a USB CDC-ACM device; the baud rate is ignored by the hardware
 * but the port must be in raw mode, which `serialport` sets up. Every write
 * waits for `drain`: a frame that reaches the pedal only in part desyncs its
 * parser for good (see docs/usb-protocol.md).
 *
 * @module usb/serialTransport
 */
import { SerialPort } from 'serialport';
import type { GreenglassTransport } from './GreenglassClient.js';

/** Largest piece handed to the OS at once: well under the serial output queue (about 1 KB). */
export const WRITE_PIECE_BYTES = 512;

/** USB IDs of the JamMan Stereo (and of the JamMan family that shares its USB stack). */
export const JAMMAN_USB_VENDOR_ID = '1210';
export const JAMMAN_USB_PRODUCT_ID = '0020';

export type SerialPortInfo = {
  path: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
};

export type ListPorts = () => Promise<SerialPortInfo[]>;

/**
 * On macOS each serial device has a `tty.*` node (blocks until carrier detect)
 * and a `cu.*` node (call-up, opens immediately). Prefer `cu.*`.
 */
export function preferCalloutDevice(path: string, platform: NodeJS.Platform = process.platform) {
  return platform === 'darwin' ? path.replace(/^\/dev\/tty\./, '/dev/cu.') : path;
}

/** Serial ports that belong to a JamMan, by USB vendor and product ID. */
export async function findJamManPorts(
  listPorts: ListPorts = () => SerialPort.list(),
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const ports = await listPorts();
  const paths = ports
    .filter(
      p =>
        p.vendorId?.toLowerCase() === JAMMAN_USB_VENDOR_ID &&
        p.productId?.toLowerCase() === JAMMAN_USB_PRODUCT_ID,
    )
    .map(p => preferCalloutDevice(p.path, platform));
  return [...new Set(paths)];
}

/** Opens a serial port and adapts it to `GreenglassTransport`. */
export async function openSerialTransport(path: string): Promise<GreenglassTransport> {
  const port = new SerialPort({ path, baudRate: 115200, autoOpen: false });
  await new Promise<void>((resolve, reject) =>
    port.open(error => (error ? reject(error) : resolve())),
  );

  let closed = false;
  const closeListeners: Array<(error?: Error) => void> = [];
  const notifyClose = (error?: Error) => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener(error);
  };
  port.on('close', (error?: Error) => notifyClose(error ?? undefined));
  port.on('error', (error: Error) => notifyClose(error));

  return {
    write: async data => {
      // Piece by piece, each one transmitted before the next. A write larger
      // than the OS output queue is accepted only in part, and serialport then
      // waits for a "writable" event to send the rest; inside the app that
      // event was seen to never come, leaving a frame half sent for good (and
      // the pedal's parser waiting for the rest). Pieces that fit the queue
      // never take that path.
      for (let offset = 0; offset < data.length; offset += WRITE_PIECE_BYTES) {
        const piece = data.subarray(offset, offset + WRITE_PIECE_BYTES);
        await new Promise<void>((resolve, reject) => {
          port.write(piece, error => {
            if (error) {
              reject(error);
              return;
            }
            port.drain(drainError => (drainError ? reject(drainError) : resolve()));
          });
        });
      }
    },
    close: () =>
      new Promise<void>(resolve => {
        if (!port.isOpen) {
          notifyClose();
          resolve();
          return;
        }
        port.close(() => {
          notifyClose();
          resolve();
        });
      }),
    onData: listener => port.on('data', (chunk: Buffer) => listener(chunk)),
    onClose: listener => closeListeners.push(listener),
  };
}
