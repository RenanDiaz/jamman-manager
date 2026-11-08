import { Dialog, Notice, PanelKey, Well } from '../../ui';
import { shortcut } from '../../utils/format';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  itemName?: string;
  itemNames?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({
  isOpen,
  itemName,
  itemNames,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  const isBatch = itemNames && itemNames.length > 0;
  const count = isBatch ? itemNames.length : 1;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      size="sm"
      title={isBatch ? `Delete ${count} patches?` : `Delete ${itemName}?`}
      footer={
        <>
          <PanelKey label="Cancel" onClick={onCancel} />
          <PanelKey
            label={isBatch ? `Delete ${count}` : 'Delete'}
            tone="danger"
            onClick={onConfirm}
          />
        </>
      }
    >
      {isBatch && (
        <Well aria-label="Patches to delete">
          {itemNames.map(name => (
            <li key={name}>{name}</li>
          ))}
        </Well>
      )}
      <Notice
        tone="warning"
        title={
          isBatch
            ? 'The patch folders and their audio files are removed from the card.'
            : 'The patch folder and its audio files are removed from the card.'
        }
      >
        <p>Undo ({shortcut('Z')}) brings them back while this card stays open.</p>
      </Notice>
    </Dialog>
  );
}
