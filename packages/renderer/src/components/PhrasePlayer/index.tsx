/**
 * Phrase Player Button
 *
 * A chrome stomp switch that loads the phrase into the global footer player.
 */

import { FC, memo } from 'react';
import { usePlayPhrase } from '../../hooks/usePlayPhrase';
import { useAudioPlayerStore } from '../../store/useAudioPlayerStore';
import { Pill, StompButton } from '../../ui';

interface Props {
  wavPath: string;
  patchDir: string;
  patchName: string;
  phraseName: string;
  /** The switch sits on a black panel rather than the blue chassis. */
  onPanel?: boolean;
}

const PhrasePlayer: FC<Props> = memo(({ wavPath, patchDir, patchName, phraseName, onPanel }) => {
  const playPhrase = usePlayPhrase();
  // Check if this phrase is currently loaded
  const isActive = useAudioPlayerStore(state => state.audioInfo?.wavPath === wavPath);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--jm-space-4)' }}>
      {isActive && <Pill>Now playing</Pill>}
      <StompButton
        label={`Play ${phraseName}`}
        active={isActive}
        onPanel={onPanel}
        onClick={() => playPhrase({ wavPath, patchDir, patchName, phraseName })}
      />
    </span>
  );
});

PhrasePlayer.displayName = 'PhrasePlayer';

export default PhrasePlayer;
