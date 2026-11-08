import { FC } from 'react';
import { formatBytes, shortcut } from '../../utils/format';
import { DisplayWindow, Led, Legend, MenuKey, Panel, PanelKey, SevenSegment } from '../../ui';
import s from './AppHeader.module.css';

interface Props {
  currentFolder: string | null;
  /** How to show the open source when it is not a plain folder (a pedal bank over USB). */
  sourceLabel: string | null;
  /** The open source is a pedal over USB (some texts change). */
  pedalMode: boolean;
  pedalConnected: boolean;
  pedalBusy: boolean;
  folderSizeBytes: number | null;
  loading: boolean;
  /** Two-digit slot of the focused patch, shown on the display. */
  focusedSlot: string | null;
  patchCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onLoad: () => void;
  onPedal: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
  onSort: () => void;
  onExportTXT: () => void;
  onExportPDF: () => void;
  onBackup: () => void;
  onPlaylists: () => void;
  onNewPatch: () => void;
}

/** The app's control panel: slot display, card status and every top-level action. */
export const AppHeader: FC<Props> = ({
  currentFolder,
  sourceLabel,
  pedalMode,
  pedalConnected,
  pedalBusy,
  folderSizeBytes,
  loading,
  focusedSlot,
  patchCount,
  canUndo,
  canRedo,
  onLoad,
  onPedal,
  onUndo,
  onRedo,
  onClose,
  onSort,
  onExportTXT,
  onExportPDF,
  onBackup,
  onPlaylists,
  onNewPatch,
}) => (
  <Panel as="header" screws="all" className={s.header}>
    <DisplayWindow>
      <SevenSegment value={focusedSlot ?? '--'} height={34} />
    </DisplayWindow>

    <div className={s.status}>
      <span>
        <Led color="green" on={!!currentFolder} />
        <Legend tone={currentFolder ? 'default' : 'muted'}>Card</Legend>
      </span>
      <span>
        <Led color="red" on={loading} />
        <Legend tone={loading ? 'default' : 'muted'}>Busy</Legend>
      </span>
    </div>

    <div className={s.brand}>
      <h1 className={s.title}>
        JamMan <span>Manager</span>
      </h1>
      <p className={s.folder} title={sourceLabel ?? currentFolder ?? undefined}>
        {currentFolder
          ? `${sourceLabel ?? currentFolder}${folderSizeBytes !== null ? `, ${formatBytes(folderSizeBytes)} ${sourceLabel ? 'used' : 'on card'}` : ''}`
          : 'No card loaded'}
      </p>
    </div>

    <nav className={s.toolbar} aria-label="Actions">
      <PanelKey label="Load patches" hint={shortcut('O')} onClick={onLoad} disabled={loading} />
      <PanelKey
        label="Pedal"
        hint="USB"
        title={pedalConnected ? 'Pedal connected over USB' : 'Connect to a JamMan over USB'}
        led={pedalConnected}
        onClick={onPedal}
        disabled={loading || pedalBusy}
      />
      <span className={s.divider} />
      <PanelKey
        label="Undo"
        hint={shortcut('Z')}
        title="Undo last action"
        onClick={onUndo}
        disabled={!canUndo || loading}
      />
      <PanelKey
        label="Redo"
        hint={shortcut('Z', { shift: true })}
        title="Redo action"
        onClick={onRedo}
        disabled={!canRedo || loading}
      />
      {currentFolder && (
        <>
          <span className={s.divider} />
          <PanelKey label="Close" hint="Folder" title="Close the loaded folder" onClick={onClose} />
          <PanelKey
            label="Sort"
            hint="Reorder"
            title={`Drag and drop to reorder patches. Changes sync to the ${pedalMode ? 'pedal' : 'SD card'}.`}
            onClick={onSort}
            disabled={patchCount === 0}
          />
          <MenuKey
            label="Export"
            hint="TXT / PDF"
            disabled={patchCount === 0}
            items={[
              { label: 'Export as TXT', onSelect: onExportTXT },
              { label: 'Export as PDF', onSelect: onExportPDF },
            ]}
          />
          <PanelKey
            label="Backup"
            hint="Restore"
            title={
              pedalMode
                ? 'Back up the pedal to a ZIP file, or restore one onto it. Audio not on this computer yet is downloaded first.'
                : 'Create ZIP backups of patches, or restore one'
            }
            onClick={onBackup}
          />
          <PanelKey
            label="Playlists"
            hint="Move to top"
            title="Organize patches into setlists for live performance"
            onClick={onPlaylists}
          />
          <span className={s.divider} />
          <PanelKey label="New patch" hint="Store" led onClick={onNewPatch} />
        </>
      )}
    </nav>
  </Panel>
);

export default AppHeader;
