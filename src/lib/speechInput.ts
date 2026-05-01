export type SpeechPermissionState = 'notRequested' | 'granted' | 'denied' | 'unsupported';

type SpeechRecognitionResultEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export type SpeechWindow = Partial<{
  SpeechRecognition: SpeechRecognitionConstructor;
  webkitSpeechRecognition: SpeechRecognitionConstructor;
}>;

export interface SpeechRecognizerHandlers {
  onResult?: (transcript: string) => void;
  onError?: (state: SpeechPermissionState) => void;
  onEnd?: () => void;
}

export interface SpeechRecognizer {
  start: () => void;
  stop: () => void;
}

export function getSpeechRecognitionSupport(source: SpeechWindow = globalThis as SpeechWindow): SpeechPermissionState {
  return getSpeechRecognitionConstructor(source) ? 'notRequested' : 'unsupported';
}

export function createSpeechRecognizer(
  source: SpeechWindow = globalThis as SpeechWindow,
  handlers: SpeechRecognizerHandlers = {},
): SpeechRecognizer | null {
  const Constructor = getSpeechRecognitionConstructor(source);

  if (!Constructor) {
    return null;
  }

  const recognition = new Constructor();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const result = event.results[0]?.[0]?.transcript?.trim() ?? '';

    if (result) {
      handlers.onResult?.(result);
    }
  };

  recognition.onerror = (event) => {
    const blocked = event.error === 'not-allowed' || event.error === 'service-not-allowed';
    handlers.onError?.(blocked ? 'denied' : 'notRequested');
  };

  recognition.onend = () => {
    handlers.onEnd?.();
  };

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
  };
}

function getSpeechRecognitionConstructor(source: SpeechWindow): SpeechRecognitionConstructor | null {
  return source.SpeechRecognition ?? source.webkitSpeechRecognition ?? null;
}
