import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({
  isOpen,
  itemName,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} toggle={onCancel}>
      <ModalHeader toggle={onCancel}>Confirm Deletion</ModalHeader>
      <ModalBody>
        <p>
          Are you sure you want to delete <strong>{itemName}</strong>?
        </p>
        <p className="text-warning mb-0">
          This action cannot be undone. All patch data and audio files will be permanently removed.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="danger" onClick={onConfirm}>
          Delete
        </Button>
      </ModalFooter>
    </Modal>
  );
}
