import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

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
    <Modal isOpen={isOpen} toggle={onCancel}>
      <ModalHeader toggle={onCancel}>Confirm Deletion</ModalHeader>
      <ModalBody>
        {isBatch ? (
          <>
            <p>
              Are you sure you want to delete <strong>{count} patches</strong>?
            </p>
            <div
              className="mb-3"
              style={{
                maxHeight: '200px',
                overflowY: 'auto',
                backgroundColor: '#f8f9fa',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #dee2e6',
              }}
            >
              <ul className="mb-0" style={{ paddingLeft: '1.5rem' }}>
                {itemNames.map(name => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p>
            Are you sure you want to delete <strong>{itemName}</strong>?
          </p>
        )}
        <p className="text-warning mb-0">
          This action cannot be undone. All patch data and audio files will be permanently removed.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="danger" onClick={onConfirm}>
          Delete {isBatch ? `${count} Patches` : ''}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
