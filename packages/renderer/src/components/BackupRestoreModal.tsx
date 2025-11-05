import { FC, useState } from 'react';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
  FormGroup,
  Label,
  Input,
  Alert,
  Spinner,
  ListGroup,
  ListGroupItem,
} from 'reactstrap';
import { toast } from 'react-toastify';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFolder: string | null;
  patches: any[];
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
  const [loading, setLoading] = useState(false);

  // Backup state
  const [backupType, setBackupType] = useState<'full' | 'selected'>('full');

  // Restore state
  const [backupFilePath, setBackupFilePath] = useState<string | null>(null);
  const [backupInfo, setBackupInfo] = useState<any>(null);
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

      const result = await window.electronAPI.restoreBackup(
        backupFilePath,
        currentFolder,
        restoreMode,
      );

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

  return (
    <Modal isOpen={isOpen} toggle={onClose} size="lg">
      <ModalHeader toggle={onClose}>Backup & Restore</ModalHeader>
      <ModalBody>
        {!currentFolder && (
          <Alert color="warning">Please load a folder first to use backup/restore features.</Alert>
        )}

        <Nav tabs>
          <NavItem>
            <NavLink
              className={activeTab === 'backup' ? 'active' : ''}
              onClick={() => handleToggleTab('backup')}
              style={{ cursor: 'pointer' }}
            >
              Create Backup
            </NavLink>
          </NavItem>
          <NavItem>
            <NavLink
              className={activeTab === 'restore' ? 'active' : ''}
              onClick={() => handleToggleTab('restore')}
              style={{ cursor: 'pointer' }}
            >
              Restore Backup
            </NavLink>
          </NavItem>
        </Nav>

        <TabContent activeTab={activeTab} className="mt-3">
          {/* Backup Tab */}
          <TabPane tabId="backup">
            <div className="mb-3">
              <p className="text-muted">
                Create a ZIP backup of your patches. Backups can be restored later or shared with
                other users.
              </p>
            </div>

            <FormGroup>
              <Label>Backup Type</Label>
              <div>
                <FormGroup check>
                  <Input
                    type="radio"
                    name="backupType"
                    checked={backupType === 'full'}
                    onChange={() => setBackupType('full')}
                    disabled={!currentFolder}
                  />
                  <Label check>
                    Full Backup <span className="text-muted">({patches.length} patches)</span>
                  </Label>
                </FormGroup>
                <FormGroup check>
                  <Input
                    type="radio"
                    name="backupType"
                    checked={backupType === 'selected'}
                    onChange={() => setBackupType('selected')}
                    disabled={!currentFolder || selectedPatchDirs.length === 0}
                  />
                  <Label check>
                    Selected Patches Only{' '}
                    <span className="text-muted">
                      ({selectedPatchDirs.length} selected)
                      {selectedPatchDirs.length === 0 && ' - Select patches first'}
                    </span>
                  </Label>
                </FormGroup>
              </div>
            </FormGroup>

            {backupType === 'selected' && selectedPatchDirs.length > 0 && (
              <div className="mb-3">
                <Label>Patches to backup:</Label>
                <div
                  style={{
                    maxHeight: '150px',
                    overflowY: 'auto',
                    backgroundColor: '#212529',
                    padding: '10px',
                    borderRadius: '4px',
                    border: '1px solid #495057',
                  }}
                >
                  <ListGroup flush>
                    {selectedPatchDirs.map(dir => {
                      const patch = patches.find(p => p.dir === dir);
                      const patchName = patch?.data?.JamManPatch?.PatchName?.[0] || '';
                      return (
                        <ListGroupItem
                          key={dir}
                          style={{ padding: '0.25rem 0', backgroundColor: 'transparent' }}
                        >
                          <strong>{dir}</strong>
                          {patchName && <small className="ms-2 text-muted">{patchName}</small>}
                        </ListGroupItem>
                      );
                    })}
                  </ListGroup>
                </div>
              </div>
            )}
          </TabPane>

          {/* Restore Tab */}
          <TabPane tabId="restore">
            <div className="mb-3">
              <p className="text-muted">
                Restore patches from a backup file. You can replace all existing patches or merge
                with them.
              </p>
            </div>

            <FormGroup>
              <Label>Backup File</Label>
              <div className="d-flex gap-2 align-items-center">
                <Button
                  color="secondary"
                  size="sm"
                  onClick={handleSelectBackupFile}
                  disabled={!currentFolder}
                >
                  Select Backup File
                </Button>
                {backupFilePath && (
                  <small className="text-truncate" style={{ maxWidth: '300px' }}>
                    {backupFilePath}
                  </small>
                )}
                {validatingBackup && <Spinner size="sm" />}
              </div>
            </FormGroup>

            {backupInfo && (
              <>
                {backupInfo.valid ? (
                  <Alert color="success">
                    <strong>Valid Backup</strong>
                    <ul className="mb-0 mt-2">
                      <li>Patches: {backupInfo.manifest.patchCount}</li>
                      <li>Created: {new Date(backupInfo.manifest.createdAt).toLocaleString()}</li>
                      <li>App Version: {backupInfo.manifest.appVersion}</li>
                    </ul>
                  </Alert>
                ) : (
                  <Alert color="danger">
                    <strong>Invalid Backup:</strong> {backupInfo.error}
                  </Alert>
                )}

                {backupInfo.valid && (
                  <>
                    <FormGroup>
                      <Label>Restore Mode</Label>
                      <div>
                        <FormGroup check>
                          <Input
                            type="radio"
                            name="restoreMode"
                            checked={restoreMode === 'merge'}
                            onChange={() => setRestoreMode('merge')}
                          />
                          <Label check>
                            <strong>Merge</strong> - Add backup patches to existing ones
                            <br />
                            <small className="text-muted">
                              Existing patches are kept. If patch numbers conflict, backup patches
                              will be renumbered.
                            </small>
                          </Label>
                        </FormGroup>
                        <FormGroup check>
                          <Input
                            type="radio"
                            name="restoreMode"
                            checked={restoreMode === 'replace'}
                            onChange={() => setRestoreMode('replace')}
                          />
                          <Label check>
                            <strong>Replace All</strong> - Remove existing patches first
                            <br />
                            <small className="text-muted">
                              ⚠️ All current patches will be deleted before restoring the backup.
                            </small>
                          </Label>
                        </FormGroup>
                      </div>
                    </FormGroup>

                    {restoreMode === 'replace' && (
                      <Alert color="warning">
                        <strong>Warning:</strong> Replace mode will delete all {patches.length}{' '}
                        existing patches before restoring the backup. This action cannot be undone.
                      </Alert>
                    )}
                  </>
                )}
              </>
            )}
          </TabPane>
        </TabContent>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        {activeTab === 'backup' ? (
          <Button color="primary" onClick={handleCreateBackup} disabled={loading || !currentFolder}>
            {loading ? (
              <>
                <Spinner size="sm" className="me-2" />
                Creating...
              </>
            ) : (
              'Create Backup'
            )}
          </Button>
        ) : (
          <Button
            color="primary"
            onClick={handleRestoreBackup}
            disabled={loading || !currentFolder || !backupInfo?.valid}
          >
            {loading ? (
              <>
                <Spinner size="sm" className="me-2" />
                Restoring...
              </>
            ) : (
              'Restore Backup'
            )}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default BackupRestoreModal;
