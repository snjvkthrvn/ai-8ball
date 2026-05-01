import { Mic, MicOff, RotateCcw, SendHorizontal } from 'lucide-react';
import type { FormEvent, Ref } from 'react';
import type { SpeechPermissionState } from '../lib/speechInput';

interface DecisionInputProps {
  value: string;
  statusText: string;
  disabled: boolean;
  isAnswered: boolean;
  isListening: boolean;
  speechState: SpeechPermissionState;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onVoice: () => void;
  onReset: () => void;
  inputRef?: Ref<HTMLInputElement>;
}

export function DecisionInput({
  value,
  statusText,
  disabled,
  isAnswered,
  isListening,
  speechState,
  onChange,
  onSubmit,
  onVoice,
  onReset,
  inputRef,
}: DecisionInputProps) {
  const speechUnavailable = speechState === 'unsupported' || speechState === 'denied';
  const inputDisabled = disabled || isAnswered;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!inputDisabled) {
      onSubmit();
    }
  };

  return (
    <section className="prompt-dock" aria-label="Decision prompt">
      <p className="status-line">{statusText}</p>
      <form className="prompt-form" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="decision-prompt">
          Ask the ball
        </label>
        <input
          id="decision-prompt"
          value={value}
          ref={inputRef}
          disabled={inputDisabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask the ball..."
          autoComplete="off"
        />
        <button
          className="icon-button"
          type="button"
          onClick={onVoice}
          disabled={inputDisabled || speechUnavailable}
          aria-pressed={isListening}
          aria-label={speechUnavailable ? 'Voice input unavailable' : 'Start voice input'}
          title={speechUnavailable ? 'Voice input unavailable' : 'Start voice input'}
        >
          {speechUnavailable ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
        </button>
        {isAnswered ? (
          <button className="submit-button" type="button" onClick={onReset}>
            <RotateCcw aria-hidden="true" />
            Ask again
          </button>
        ) : (
          <button className="submit-button" type="submit" disabled={disabled}>
            <SendHorizontal aria-hidden="true" />
            Ask
          </button>
        )}
      </form>
    </section>
  );
}
