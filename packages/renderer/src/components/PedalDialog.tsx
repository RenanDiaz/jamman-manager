import type { PedalBankInfo, PedalInfo } from '@app/preload/ipc-contract';
import { Dialog, Led, Notice, PanelKey } from '../ui';
import { formatBytes } from '../utils/format';
import { BANK_LABELS } from '../utils/pedal';
import s from './PedalDialog.module.css';

interface Props {
  isOpen: boolean;
  pedal: PedalInfo | null;
  /** The folder path open now, to mark its bank. */
  currentFolder: string | null;
  onOpenBank: (bank: PedalBankInfo) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

/** The pedal connected over USB: pick the bank to open, or disconnect. */
export default function PedalDialog({
  isOpen,
  pedal,
  currentFolder,
  onOpenBank,
  onDisconnect,
  onClose,
}: Props) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      title={pedal ? pedal.name : 'Pedal'}
      subtitle={pedal ? `Connected over USB, firmware ${pedal.firmwareVersion}` : undefined}
      footer={
        <>
          {pedal && <PanelKey label="Disconnect" onClick={onDisconnect} />}
          <PanelKey label="Close" onClick={onClose} />
        </>
      }
    >
      {pedal ? (
        <>
          <ul aria-label="Banks" className={s.banks}>
            {pedal.banks.map(bank => {
              const isOpenNow = bank.path === currentFolder;
              const used = bank.capacityBytes - bank.freeBytes;
              return (
                <li key={bank.id} className={s.bank}>
                  <span>
                    <span className={s.bankName}>
                      <Led color="green" on={isOpenNow} />
                      {BANK_LABELS[bank.id]}
                    </span>
                    <span className={s.bankMeta}>
                      {bank.available
                        ? `${formatBytes(used)} used of ${formatBytes(bank.capacityBytes)}`
                        : 'No card inserted'}
                    </span>
                  </span>
                  <PanelKey
                    label={isOpenNow ? 'Reload' : 'Open'}
                    led={!isOpenNow}
                    disabled={!bank.available}
                    onClick={() => onOpenBank(bank)}
                  />
                </li>
              );
            })}
          </ul>
          <Notice title="What works over USB">
            <p>
              Browse, play, edit, sort and delete patches, with undo. New patches, new or changed
              WAV files, backups and playlists still need the SD card in a card reader.
            </p>
          </Notice>
        </>
      ) : (
        <p>The pedal is not connected.</p>
      )}
    </Dialog>
  );
}
