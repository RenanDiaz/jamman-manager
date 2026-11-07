/**
 * Export of the patch list to a file the user picks (TXT or PDF).
 *
 * Channels: `patches:exportTXT`, `patches:exportPDF`.
 *
 * @module ipc/export
 */
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import type { ExportPatch, IpcHandlers } from '@app/preload/ipc-contract';
import type { IpcDeps } from './deps.js';
import { ipcError } from './errors.js';

export type ExportChannel = 'patches:exportTXT' | 'patches:exportPDF';

const patchNameOf = (patch: ExportPatch) => patch.data?.JamManPatch?.PatchName?.[0] || 'Unknown';

export function createExportHandlers({
  fs,
  log,
  dialog,
}: Pick<IpcDeps, 'fs' | 'log' | 'dialog'>): IpcHandlers<ExportChannel> {
  return {
    'patches:exportTXT': async (patches, basePath) => {
      try {
        const result = await dialog.showSaveDialog({
          title: 'Export Patches to TXT',
          defaultPath: path.join(basePath, 'jamman-patches.txt'),
          filters: [{ name: 'Text Files', extensions: ['txt'] }],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        let content = 'JamMan Patches Export\n';
        content += `Generated: ${new Date().toLocaleString()}\n`;
        content += '='.repeat(80) + '\n\n';
        patches.forEach((patch, index) => {
          content += `${index + 1}. ${patchNameOf(patch)}\n`;
        });

        fs.writeFileSync(result.filePath, content, 'utf-8');
        log.info(`Successfully exported ${patches.length} patches to TXT: ${result.filePath}`);

        return { success: true, filePath: result.filePath };
      } catch (error) {
        throw ipcError(log, 'Error exporting patches to TXT:', 'Failed to export patches', error);
      }
    },

    'patches:exportPDF': async (patches, basePath) => {
      try {
        const result = await dialog.showSaveDialog({
          title: 'Export Patches to PDF',
          defaultPath: path.join(basePath, 'jamman-patches.pdf'),
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(result.filePath);
        doc.pipe(stream);

        doc.fontSize(20).text('JamMan Patches Export', { align: 'center' });
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        patches.forEach((patch, index) => {
          // New page when this one is full
          if (index > 0 && doc.y > 700) {
            doc.addPage();
          }
          doc
            .fontSize(12)
            .fillColor('black')
            .text(`${index + 1}. ${patchNameOf(patch)}`);
          doc.moveDown(0.3);
        });

        doc.end();

        // Wait for the stream to finish
        await new Promise<void>((resolve, reject) => {
          stream.on('finish', () => resolve());
          stream.on('error', reject);
        });

        log.info(`Successfully exported ${patches.length} patches to PDF: ${result.filePath}`);
        return { success: true, filePath: result.filePath };
      } catch (error) {
        throw ipcError(log, 'Error exporting patches to PDF:', 'Failed to export patches', error);
      }
    },
  };
}
