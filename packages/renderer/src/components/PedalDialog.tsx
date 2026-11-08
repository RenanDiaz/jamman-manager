import { useState } from 'react';
import { toast } from 'react-toastify';
import type {
  PedalButton,
  PedalAudioStatus,
  PedalBankId,
  PedalBankInfo,
  PedalInfo,
} from '@app/preload/ipc-contract';
import { Dialog, Field, Led, Notice, PanelKey, Select } from '../ui';
import { formatBytes } from '../utils/format';
import { BANK_LABELS, isCanceled, transferTime } from '../utils/pedal';
import PedalTransfer from './PedalTransfer';
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

const BUTTONS: Array<{ id: PedalButton; label: string }> = [
  { id: 'left', label: 'Left' },
  { id: 'middle', label: 'Middle' },
  { id: 'right', label: 'Right' },
];

/** How the pedal's button commands read in the app. Unknown ones show as the pedal names them. */
const BUTTON_COMMAND_LABELS: Record<string, string> = {
  UndoRedo: 'Undo / redo',
  Reverse: 'Reverse',
  Tempo: 'Tempo',
};

/** Where the "download all audio" flow of one bank stands. */
type AudioStep =
  | { bank: PedalBankId; step: 'checking' }
  | { bank: PedalBankId; step: 'ready'; status: PedalAudioStatus }
  | { bank: PedalBankId; step: 'downloading' };

/** The pedal connected over USB: pick the bank to open, download its audio, or disconnect. */
export default function PedalDialog({
  isOpen,
  pedal,
  currentFolder,
  onOpenBank,
  onDisconnect,
  onClose,
}: Props) {
  const [audio, setAudio] = useState<AudioStep | null>(null);
  const busy = audio?.step === 'downloading';
  const [settingButton, setSettingButton] = useState(false);

  const setButton = async (button: PedalButton, command: string) => {
    setSettingButton(true);
    try {
      await window.electronAPI.setPedalButton(button, command);
    } catch (error) {
      console.error('Error setting a pedal button:', error);
      toast.error('The pedal did not take the new button setting');
    } finally {
      setSettingButton(false);
    }
  };

  const checkAudio = async (bank: PedalBankInfo) => {
    setAudio({ bank: bank.id, step: 'checking' });
    try {
      const status = await window.electronAPI.getPedalAudioStatus(bank.path);
      setAudio({ bank: bank.id, step: 'ready', status });
    } catch (error) {
      console.error('Error checking the pedal audio:', error);
      toast.error('Could not check the audio on the pedal');
      setAudio(null);
    }
  };

  const download = async (bank: PedalBankInfo) => {
    setAudio({ bank: bank.id, step: 'downloading' });
    try {
      const status = await window.electronAPI.downloadPedalAudio(bank.path);
      toast.success(
        `All ${status.files} WAV files of the ${BANK_LABELS[bank.id].toLowerCase()} are on this computer`,
      );
    } catch (error) {
      if (isCanceled(error)) {
        toast.info('Download stopped. What was downloaded is kept; it resumes next time.');
      } else {
        console.error('Error downloading the pedal audio:', error);
        toast.error('The download failed. What was downloaded is kept.');
      }
    } finally {
      setAudio(null);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={pedal ? pedal.name : 'Pedal'}
      subtitle={pedal ? `Connected over USB, firmware ${pedal.firmwareVersion}` : undefined}
      footer={
        <>
          {pedal && <PanelKey label="Disconnect" onClick={onDisconnect} disabled={busy} />}
          <PanelKey label="Close" onClick={onClose} disabled={busy} />
        </>
      }
    >
      {pedal ? (
        <>
          <ul aria-label="Banks" className={s.banks}>
            {pedal.banks.map(bank => {
              const isOpenNow = bank.path === currentFolder;
              const used = bank.capacityBytes - bank.freeBytes;
              const mine = audio?.bank === bank.id ? audio : null;
              return (
                <li key={bank.id} className={s.bankItem}>
                  <div className={s.bank}>
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
                    <span className={s.keys}>
                      <PanelKey
                        label="Audio"
                        size="sm"
                        title="Download this bank's audio to this computer"
                        disabled={!bank.available || audio !== null}
                        onClick={() => checkAudio(bank)}
                      />
                      <PanelKey
                        label={isOpenNow ? 'Reload' : 'Open'}
                        led={!isOpenNow}
                        disabled={!bank.available || busy}
                        onClick={() => onOpenBank(bank)}
                      />
                    </span>
                  </div>

                  {mine?.step === 'checking' && (
                    <p className={s.bankMeta} role="status">
                      Checking which audio is already on this computer…
                    </p>
                  )}
                  {mine?.step === 'ready' && (
                    <AudioOffer
                      status={mine.status}
                      onDownload={() => download(bank)}
                      onCancel={() => setAudio(null)}
                    />
                  )}
                  {mine?.step === 'downloading' && <PedalTransfer />}
                </li>
              );
            })}
          </ul>
          <section aria-labelledby="pedal-buttons" className={s.buttons}>
            <h3 id="pedal-buttons" className={s.sectionTitle}>
              Footswitch buttons
            </h3>
            <div className={s.buttonRow}>
              {BUTTONS.map(({ id, label }) => (
                <Field key={id} label={label} htmlFor={`pedal-button-${id}`}>
                  <Select
                    id={`pedal-button-${id}`}
                    value={pedal.buttons[id]}
                    disabled={busy || settingButton}
                    onChange={e => setButton(id, e.target.value)}
                  >
                    {pedal.buttonCommands.map(command => (
                      <option key={command} value={command}>
                        {BUTTON_COMMAND_LABELS[command] ?? command}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            <p className={s.bankMeta}>The pedal keeps these when it is turned off.</p>
          </section>

          <Notice title="What works over USB">
            <p>
              Everything the app does with a card. Audio moves at about 1.3 MB per second from the
              pedal and 1.5 MB per second to it, so for a large bank a card reader is faster.
            </p>
          </Notice>
        </>
      ) : (
        <p>The pedal is not connected.</p>
      )}
    </Dialog>
  );
}

function AudioOffer({
  status,
  onDownload,
  onCancel,
}: {
  status: PedalAudioStatus;
  onDownload: () => void;
  onCancel: () => void;
}) {
  const missing = status.totalBytes - status.cachedBytes;
  if (missing <= 0) {
    return (
      <Notice tone="success" title="All the audio is already on this computer.">
        <p>
          {status.files} WAV files, {formatBytes(status.totalBytes)}. Playback and backups of this
          bank do not wait on USB.
        </p>
        <PanelKey label="OK" size="sm" onClick={onCancel} />
      </Notice>
    );
  }
  return (
    <Notice
      tone={missing > 200e6 ? 'warning' : 'info'}
      title={`${formatBytes(missing)} to download: ${transferTime(missing, 'download')}.`}
    >
      <p>
        {status.cachedFiles} of {status.files} WAV files are already here. You can stop and resume
        later. For a large bank, taking the SD card out and using a card reader is much faster.
      </p>
      <span className={s.keys}>
        <PanelKey label="Not now" size="sm" onClick={onCancel} />
        <PanelKey label="Download" size="sm" led onClick={onDownload} />
      </span>
    </Notice>
  );
}
