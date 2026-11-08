import { Notice, PanelKey } from '../ui';
import { usePedalStore } from '../store/usePedalStore';
import { formatBytes } from '../utils/format';
import s from './PedalTransfer.module.css';

/**
 * Progress of the download or upload running on the pedal, with a key to stop
 * it. Renders nothing while no transfer reports progress.
 */
export default function PedalTransfer() {
  const progress = usePedalStore(state => state.progress);
  if (!progress) return null;
  const percent = Math.floor((100 * progress.done) / Math.max(progress.total, 1));
  return (
    <Notice title={progress.label} role="status">
      <progress value={progress.done} max={Math.max(progress.total, 1)} className={s.bar} />
      <div className={s.row}>
        <span>
          {percent}%, {formatBytes(progress.done)} of {formatBytes(progress.total)}
        </span>
        <PanelKey
          label="Stop"
          size="sm"
          onClick={() => {
            window.electronAPI.cancelPedalOperation().catch(() => undefined);
          }}
        />
      </div>
    </Notice>
  );
}
