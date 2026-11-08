import { FC, useState } from 'react';
import { toast } from 'react-toastify';
import type { Patch } from '../types';
import { usePatchStore } from '../store/usePatchStore';
import {
  ChoiceGroup,
  Dialog,
  Led,
  ModeKeys,
  modePanelId,
  modeTabId,
  Notice,
  PanelKey,
  Well,
} from '../ui';
import { fileName } from '../utils/format';
import s from './BackupRestoreModal.module.css';

interface BackupInfo {
  valid: boolean;
  manifest?: {
    patchCount: number;
    createdAt: string;
    appVersion: string;
  };
  error?: string;
}

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFolder: string | null;
  patches: Patch[];
  selectedPatchDirs: string[];
  onBackupComplete?: () => void;
  onRestoreComplete?: () => void;
}

export const BackupRestoreModal: FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  currentFolder,
  patches,
  selectedPatchDirs,
  onBackupComplete,
  onRestoreComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'backup' | 'restore'>('backup');
  const restoreBackup = usePatchStore(state => state.restoreBackup);
  const [loading, setLoading] = useState(false);

  // Backup state
  const [backupType, setBackupType] = useState<'full' | 'selected'>('full');

  // Restore state
  const [backupFilePath, setBackupFilePath] = useState<string | null>(null);
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('merge');
  const [validatingBackup, setValidatingBackup] = useState(false);

  const handleToggleTab = (tab: 'backup' | 'restore') => {
    setActiveTab(tab);
    // Reset state when switching tabs
    if (tab === 'restore') {
      setBackupFilePath(null);
      setBackupInfo(null);
    }
  };

  const handleCreateBackup = async () => {
    if (!currentFolder) {
      toast.error('No folder loaded');
      return;
    }

    try {
      setLoading(true);

      const patchesToBackup = backupType === 'selected' ? selectedPatchDirs : undefined;

      if (backupType === 'selected' && selectedPatchDirs.length === 0) {
        toast.warning('No patches selected for backup');
        return;
      }

      const result = await window.electronAPI.createBackup(currentFolder, patchesToBackup, false);

      if (result.canceled) {
        // User canceled, no message needed
        return;
      }

      if (result.success && result.filePath) {
        toast.success(`Backup created successfully at ${result.filePath}`);
        if (onBackupComplete) onBackupComplete();
        onClose();
      }
    } catch (error) {
      console.error('Error creating backup:', error);
      toast.error('Failed to create backup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBackupFile = async () => {
    try {
      const filePath = await window.electronAPI.selectBackupFile();
      if (filePath) {
        setBackupFilePath(filePath);
        setValidatingBackup(true);

        // Validate the backup file
        const info = await window.electronAPI.validateBackup(filePath);
        setBackupInfo(info);
        setValidatingBackup(false);

        if (!info.valid) {
          toast.error(`Invalid backup: ${info.error}`);
        }
      }
    } catch (error) {
      console.error('Error selecting backup file:', error);
      toast.error('Failed to validate backup file');
      setValidatingBackup(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!currentFolder || !backupFilePath || !backupInfo?.valid) {
      toast.error('Please select a valid backup file');
      return;
    }

    try {
      setLoading(true);

      const result = await restoreBackup(backupFilePath, restoreMode);

      if (result.success) {
        toast.success(
          `Successfully restored ${result.patchesRestored} patches in ${restoreMode} mode`,
        );
        if (onRestoreComplete) onRestoreComplete();
        onClose();
      }
    } catch (error) {
      console.error('Error restoring backup:', error);
      toast.error('Failed to restore backup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const tabPrefix = 'backup-restore';
  const patchName = (dir: string) =>
    patches.find(p => p.dir === dir)?.data?.JamManPatch?.PatchName?.[0] || '';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      dismissible={!loading}
      size="lg"
      title="Backup & restore"
      subtitle="Backups are ZIP files you can restore later or share."
      footer={
        <>
          <PanelKey label="Cancel" onClick={onClose} disabled={loading} />
          {activeTab === 'backup' ? (
            <PanelKey
              led
              label={loading ? 'Creating…' : 'Create backup'}
              onClick={handleCreateBackup}
              disabled={loading || !currentFolder}
            />
          ) : (
            <PanelKey
              led
              label={loading ? 'Restoring…' : 'Restore'}
              onClick={handleRestoreBackup}
              disabled={loading || !currentFolder || !backupInfo?.valid}
            />
          )}
        </>
      }
    >
      {!currentFolder && (
        <Notice tone="warning">
          <p>Load a card first to back it up or restore onto it.</p>
        </Notice>
      )}

      <ModeKeys
        label="Mode"
        idPrefix={tabPrefix}
        value={activeTab}
        onChange={handleToggleTab}
        options={[
          { value: 'backup', label: 'Back up' },
          { value: 'restore', label: 'Restore' },
        ]}
      />

      {activeTab === 'backup' ? (
        <div
          role="tabpanel"
          id={modePanelId(tabPrefix, 'backup')}
          aria-labelledby={modeTabId(tabPrefix, 'backup')}
          className={s.panel}
        >
          <ChoiceGroup
            legend="What to back up"
            name="backupType"
            value={backupType}
            onChange={setBackupType}
            disabled={!currentFolder}
            options={[
              {
                value: 'full',
                label: 'The whole card',
                description: `${patches.length} patches`,
              },
              {
                value: 'selected',
                label: 'Selected patches only',
                description:
                  selectedPatchDirs.length === 0
                    ? 'Select patches in the list first.'
                    : `${selectedPatchDirs.length} selected`,
                disabled: selectedPatchDirs.length === 0,
              },
            ]}
          />

          {backupType === 'selected' && selectedPatchDirs.length > 0 && (
            <Well aria-label="Patches to back up">
              {selectedPatchDirs.map(dir => (
                <li key={dir}>
                  <strong>{dir}</strong>
                  <span className={s.muted}>{patchName(dir)}</span>
                </li>
              ))}
            </Well>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id={modePanelId(tabPrefix, 'restore')}
          aria-labelledby={modeTabId(tabPrefix, 'restore')}
          className={s.panel}
        >
          <div className={s.file}>
            <PanelKey
              label={backupFilePath ? 'Choose another file' : 'Choose backup file'}
              onClick={handleSelectBackupFile}
              disabled={!currentFolder}
            />
            {validatingBackup ? (
              <span className={s.status} role="status">
                <Led color="red" on blinkSeconds={0.4} />
                Checking the file…
              </span>
            ) : (
              backupFilePath && (
                <span className={s.path} title={backupFilePath}>
                  {fileName(backupFilePath)}
                </span>
              )
            )}
          </div>

          {backupInfo &&
            (backupInfo.valid ? (
              <>
                <Notice tone="success" title="This backup can be restored.">
                  <dl className={s.facts}>
                    <dt>Patches</dt>
                    <dd>{backupInfo.manifest?.patchCount}</dd>
                    <dt>Created</dt>
                    <dd>{new Date(backupInfo.manifest?.createdAt || '').toLocaleString()}</dd>
                    <dt>App version</dt>
                    <dd>{backupInfo.manifest?.appVersion}</dd>
                  </dl>
                </Notice>

                <ChoiceGroup
                  legend="How to restore"
                  name="restoreMode"
                  value={restoreMode}
                  onChange={setRestoreMode}
                  options={[
                    {
                      value: 'merge',
                      label: 'Merge',
                      description:
                        'Keeps the patches on the card. Backup patches whose slot is taken get a new number.',
                    },
                    {
                      value: 'replace',
                      label: 'Replace all',
                      description: 'Deletes every patch on the card, then restores the backup.',
                    },
                  ]}
                />

                {restoreMode === 'replace' && (
                  <Notice
                    tone="warning"
                    title={`The ${patches.length} patches on the card are deleted first.`}
                  >
                    <p>Undo can bring them back while this card stays open.</p>
                  </Notice>
                )}
              </>
            ) : (
              <Notice tone="danger" title="This file can't be restored.">
                <p>{backupInfo.error}</p>
              </Notice>
            ))}
        </div>
      )}
    </Dialog>
  );
};

export default BackupRestoreModal;
