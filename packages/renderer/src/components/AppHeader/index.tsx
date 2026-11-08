import { FC } from 'react';
import { formatBytes, shortcut } from '../../utils/format';
import { DisplayWindow, Led, Legend, MenuKey, Panel, PanelKey, SevenSegment } from '../../ui';
import s from './AppHeader.module.css';

interface Props {
  currentFolder: string | null;
  folderSizeBytes: number | null;
  loading: boolean;
  /** Two-digit slot of the focused patch, shown on the display. */
  focusedSlot: string | null;
  patchCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onLoad: () => void;
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
  folderSizeBytes,
  loading,
  focusedSlot,
  patchCount,
  canUndo,
  canRedo,
  onLoad,
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
      <p className={s.folder} title={currentFolder ?? undefined}>
        {currentFolder
          ? `${currentFolder}${folderSizeBytes !== null ? `, ${formatBytes(folderSizeBytes)} on card` : ''}`
          : 'No card loaded'}
      </p>
    </div>

    <nav className={s.toolbar} aria-label="Actions">
      <PanelKey label="Load patches" hint={shortcut('O')} onClick={onLoad} disabled={loading} />
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
            title="Drag and drop to reorder patches. Changes sync to the SD card."
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
            title="Create ZIP backups of patches, or restore one"
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
