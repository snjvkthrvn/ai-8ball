import { describe, expect, it, vi } from 'vitest';
import { createSpeechRecognizer, getSpeechRecognitionSupport } from './speechInput';

describe('speechInput', () => {
  it('reports unsupported when speech recognition is unavailable', () => {
    expect(getSpeechRecognitionSupport({})).toBe('unsupported');
  });

  it('creates a recognizer when browser speech recognition exists', () => {
    const start = vi.fn();
    const stop = vi.fn();

    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = start;
      stop = stop;
    }

    const recognizer = createSpeechRecognizer({
      SpeechRecognition: FakeSpeechRecognition,
    });

    expect(recognizer).not.toBeNull();
    recognizer?.start();
    recognizer?.stop();

    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
