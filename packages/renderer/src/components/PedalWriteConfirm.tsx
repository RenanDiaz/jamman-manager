import { Dialog, Notice, PanelKey } from '../ui';
import { usePedalGuardStore } from '../store/usePedalGuardStore';

/** The question `confirmPedalWrite` asks before changing a pedal that is busy with it. */
export default function PedalWriteConfirm() {
  const question = usePedalGuardStore(state => state.question);
  const answer = usePedalGuardStore(state => state.answer);
  return (
    <Dialog
      isOpen={question !== null}
      onClose={() => answer(false)}
      size="sm"
      title="Change the pedal now?"
      footer={
        <>
          <PanelKey label="Cancel" onClick={() => answer(false)} />
          <PanelKey label="Change it" led onClick={() => answer(true)} />
        </>
      }
    >
      {question && (
        <Notice tone="warning" title={question.title}>
          {question.details.map(line => (
            <p key={line}>{line}</p>
          ))}
        </Notice>
      )}
    </Dialog>
  );
}
