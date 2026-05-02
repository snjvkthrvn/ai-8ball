import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { DecisionInput } from './components/DecisionInput';
import { EightBall } from './components/EightBall';
import { createMockDecisionOptions } from './lib/mockDecisionEngine';
import { fetchOracleOptions } from './lib/oracleClient';
import { createShakeController } from './lib/shakeController';
import {
  createSpeechRecognizer,
  getSpeechRecognitionSupport,
  type SpeechPermissionState,
  type SpeechRecognizer,
  type SpeechWindow,
} from './lib/speechInput';

type AppState = 'idle' | 'listening' | 'readyToShake' | 'shaking' | 'revealing' | 'answered';
type MotionPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';
type PointerSample = { x: number; y: number; time: number; valid: boolean };

type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

/* ─── Reveal timing ────────────────────────────────────────────────────────
 * After the user shakes hard enough we *arm* the reveal rather than fire it
 * straight away — pointer release (or, for keyboard/device-motion shakes
 * where there is no “release” event, a short grace timeout) is what actually
 * starts the answer animation. Once it starts, the answer text scrambles
 * through the candidate options before locking in, which is the classic
 * dice-rolling feel of a real Magic 8 Ball.
 * ────────────────────────────────────────────────────────────────────────── */
const ARM_AUTO_FIRE_MS = 600;
const SCRAMBLE_DURATION_MS = 1400;
const SCRAMBLE_INTERVAL_MS = 70;
const SETTLE_MS = 520;

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [energy, setEnergy] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [speechState, setSpeechState] = useState<SpeechPermissionState>(() => getSpeechRecognitionSupport());
  const [motionPermission, setMotionPermission] = useState<MotionPermission>('unknown');
  const [submitBusy, setSubmitBusy] = useState(false);
  /** Which brain fed the three options (shown small in the masthead). */
  const [oracleSource, setOracleSource] = useState<'gemini' | 'local' | null>(null);

  const shakeController = useRef(createShakeController());
  const lastPointer = useRef<PointerSample | null>(null);
  const recognizer = useRef<SpeechRecognizer | null>(null);
  const revealStarted = useRef(false);
  const armedRef = useRef(false);
  const armTimerRef = useRef<number | null>(null);
  const scrambleTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const promptRef = useRef<HTMLInputElement | null>(null);

  const inputLocked =
    appState === 'readyToShake' || appState === 'shaking' || appState === 'revealing' || submitBusy;
  const canShake = appState === 'readyToShake' || appState === 'shaking';

  const statusText = useMemo(() => {
    if (submitBusy) return 'Consulting the oracle…';
    if (appState === 'listening') return 'Listening';
    if (appState === 'readyToShake') return 'Shake the ball';
    if (appState === 'shaking') return armedRef.current ? 'Let go to reveal' : 'Keep shaking';
    if (appState === 'revealing') return 'Settling';
    if (appState === 'answered') return 'Answered';
    if (speechState === 'denied') return 'Voice blocked';
    return 'Ask anything';
  }, [appState, speechState, submitBusy]);

  const clearRevealTimers = useCallback(() => {
    if (armTimerRef.current != null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    if (scrambleTimerRef.current != null) {
      window.clearInterval(scrambleTimerRef.current);
      scrambleTimerRef.current = null;
    }
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    armedRef.current = false;
  }, []);

  const resetShake = useCallback(() => {
    shakeController.current.reset();
    setEnergy(0);
    setTilt({ x: 0, y: 0 });
    revealStarted.current = false;
    clearRevealTimers();
  }, [clearRevealTimers]);

  /** Begin the scramble + settle animation. Picks the final answer up front
   *  so the scramble loop is purely cosmetic — the outcome is locked the
   *  moment the spinner starts. */
  const startReveal = useCallback(() => {
    if (revealStarted.current || options.length === 0) {
      return;
    }

    revealStarted.current = true;
    armedRef.current = false;
    if (armTimerRef.current != null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }

    const finalAnswer = options[Math.floor(Math.random() * options.length)];
    // Only cycle the real three options so nothing unrelated flashes on screen.
    const scramblePool =
      options.length >= 3
        ? [...options, ...options, ...options, ...options]
        : [...options];

    setAppState('revealing');
    // First scramble pick is shown immediately so the face never blanks.
    setAnswer(pickDifferent(scramblePool, null));

    let lastShown: string | null = null;
    scrambleTimerRef.current = window.setInterval(() => {
      const next = pickDifferent(scramblePool, lastShown);
      lastShown = next;
      setAnswer(next);
    }, SCRAMBLE_INTERVAL_MS);

    settleTimerRef.current = window.setTimeout(() => {
      if (scrambleTimerRef.current != null) {
        window.clearInterval(scrambleTimerRef.current);
        scrambleTimerRef.current = null;
      }
      setAnswer(finalAnswer);
      settleTimerRef.current = window.setTimeout(() => {
        setAppState('answered');
        setTilt({ x: 0, y: 0 });
        shakeController.current.reset();
        setEnergy(0);
        settleTimerRef.current = null;
      }, SETTLE_MS);
    }, SCRAMBLE_DURATION_MS);
  }, [options]);

  /** Mark the reveal as ready to fire. Pointer-up will fire it; if no pointer
   *  release ever arrives (keyboard / device-motion), a fallback timer fires
   *  after `ARM_AUTO_FIRE_MS` so the shake doesn’t hang forever. */
  const armReveal = useCallback(() => {
    if (armedRef.current || revealStarted.current) {
      return;
    }
    armedRef.current = true;
    armTimerRef.current = window.setTimeout(() => {
      armTimerRef.current = null;
      startReveal();
    }, ARM_AUTO_FIRE_MS);
  }, [startReveal]);

  const updateEnergy = useCallback(
    (nextEnergy: number) => {
      setEnergy(nextEnergy);

      if (nextEnergy >= 15 && appState === 'readyToShake') {
        setAppState('shaking');
      }

      if (shakeController.current.shouldReveal()) {
        armReveal();
      }
    },
    [appState, armReveal],
  );

  const requestMotionPermission = useCallback(async () => {
    const MotionEventConstructor = globalThis.DeviceMotionEvent as DeviceMotionEventWithPermission | undefined;

    if (!MotionEventConstructor) {
      setMotionPermission('unsupported');
      return;
    }

    if (typeof MotionEventConstructor.requestPermission !== 'function') {
      setMotionPermission('granted');
      return;
    }

    try {
      const result = await MotionEventConstructor.requestPermission();
      setMotionPermission(result === 'granted' ? 'granted' : 'denied');
    } catch {
      setMotionPermission('denied');
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();

    const cantSubmit =
      !trimmed ||
      submitBusy ||
      appState === 'answered' ||
      appState === 'readyToShake' ||
      appState === 'shaking' ||
      appState === 'revealing';

    if (cantSubmit) {
      promptRef.current?.focus();
      return;
    }

    setSubmitBusy(true);
    let generatedOptions = createMockDecisionOptions(trimmed);
    let usedGemini = false;
    try {
      const fromApi = await fetchOracleOptions(trimmed);
      if (fromApi.length >= 3) {
        generatedOptions = fromApi.slice(0, 3);
        usedGemini = true;
      }
    } catch (error) {
      console.warn('[oracle] Gemini request failed — using built-in options.', error);
    } finally {
      setSubmitBusy(false);
    }

    setOracleSource(usedGemini ? 'gemini' : 'local');

    setOptions(generatedOptions);
    setAnswer(null);
    setAppState('readyToShake');
    resetShake();
    void requestMotionPermission();
  }, [appState, prompt, requestMotionPermission, resetShake, submitBusy]);

  const handleReset = useCallback(() => {
    setPrompt('');
    setOptions([]);
    setAnswer(null);
    setAppState('idle');
    setOracleSource(null);
    resetShake();
    window.setTimeout(() => promptRef.current?.focus(), 0);
  }, [resetShake]);

  const handleVoice = useCallback(() => {
    if (speechState === 'unsupported' || speechState === 'denied' || inputLocked || appState === 'answered') {
      return;
    }

    if (appState === 'listening') {
      recognizer.current?.stop();
      setAppState('idle');
      return;
    }

    const nextRecognizer = createSpeechRecognizer(globalThis as SpeechWindow, {
      onResult: (transcript) => {
        setPrompt(transcript);
        setSpeechState('granted');
      },
      onError: (state) => {
        setSpeechState(state);
        setAppState('idle');
      },
      onEnd: () => {
        setAppState((current) => (current === 'listening' ? 'idle' : current));
      },
    });

    if (!nextRecognizer) {
      setSpeechState('unsupported');
      return;
    }

    recognizer.current = nextRecognizer;

    try {
      nextRecognizer.start();
      setSpeechState('granted');
      setAppState('listening');
    } catch {
      setSpeechState('denied');
    }
  }, [appState, inputLocked, speechState]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    lastPointer.current = getPointerSample(event);
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const previous = lastPointer.current;

      if (!previous) {
        return;
      }

      const sample = getPointerSample(event);
      const hasUsableCoordinates = previous.valid && sample.valid;
      const dx = hasUsableCoordinates ? sample.x - previous.x : 900;
      const dy = hasUsableCoordinates ? sample.y - previous.y : 0;
      const seconds = Math.max((sample.time - previous.time) / 1000, 0.016);
      const distance = Math.hypot(dx, dy);
      const velocity = distance / seconds;

      lastPointer.current = sample;
      setTilt({
        x: Math.max(-12, Math.min(12, dy / 10)),
        y: Math.max(-12, Math.min(12, -dx / 10)),
      });

      if (!canShake) {
        return;
      }

      updateEnergy(shakeController.current.addPointerVelocity(velocity));
    },
    [canShake, updateEnergy],
  );

  const handlePointerUp = useCallback(() => {
    lastPointer.current = null;
    setTilt({ x: 0, y: 0 });
    if (armedRef.current) {
      startReveal();
    }
  }, [startReveal]);

  const handleKeyboardShake = useCallback(() => {
    if (!canShake) {
      return;
    }

    updateEnergy(shakeController.current.addPointerVelocity(1600));
  }, [canShake, updateEnergy]);

  useEffect(() => {
    // Energy keeps decaying through `revealing` too, so the ball’s rattle
    // tapers naturally during the answer scramble instead of cutting off.
    const isActive = canShake || appState === 'revealing';
    if (!isActive) {
      return;
    }

    let frame = 0;
    let previous = performance.now();

    const tick = (time: number) => {
      const seconds = Math.max((time - previous) / 1000, 0);
      previous = time;
      const nextEnergy = shakeController.current.decay(seconds);
      setEnergy(nextEnergy);

      if (nextEnergy < 15 && appState === 'shaking') {
        setAppState('readyToShake');
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [appState, canShake]);

  useEffect(() => clearRevealTimers, [clearRevealTimers]);

  useEffect(() => {
    if (!canShake || motionPermission !== 'granted') {
      return;
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity;

      if (!acceleration) {
        return;
      }

      const x = acceleration.x ?? 0;
      const y = acceleration.y ?? 0;
      const z = acceleration.z ?? 0;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      updateEnergy(shakeController.current.addMotionMagnitude(magnitude));
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [canShake, motionPermission, updateEnergy]);

  return (
    <main className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <section className="oracle-space" aria-label="8-ball decision space">
        <div className="masthead">
          <p>8 Ball</p>
          <span>
            {oracleSource === 'gemini'
              ? 'Gemini answers'
              : oracleSource === 'local'
                ? 'Built-in answers (oracle unavailable)'
                : motionPermission === 'denied'
                  ? 'Touch shake active'
                  : 'Quiet Oracle'}
          </span>
        </div>
        <EightBall
          answer={answer}
          state={appState}
          energy={energy}
          tilt={tilt}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyboardShake={handleKeyboardShake}
        />
      </section>
      <DecisionInput
        value={prompt}
        statusText={statusText}
        disabled={inputLocked}
        isAnswered={appState === 'answered'}
        isListening={appState === 'listening'}
        speechState={speechState}
        onChange={setPrompt}
        onSubmit={handleSubmit}
        onVoice={handleVoice}
        onReset={handleReset}
        inputRef={promptRef}
      />
    </main>
  );
}

/** Pick a random item from `pool` that is not `previous` (when possible). */
function pickDifferent<T>(pool: readonly T[], previous: T | null): T {
  if (pool.length === 0) {
    throw new Error('pickDifferent: empty pool');
  }
  if (pool.length === 1) {
    return pool[0];
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (candidate !== previous) {
      return candidate;
    }
  }
  return pool[0];
}

function getPointerSample(event: PointerEvent<HTMLDivElement>): PointerSample {
  const x = Number.isFinite(event.clientX) ? event.clientX : 0;
  const y = Number.isFinite(event.clientY) ? event.clientY : 0;
  const time = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  return {
    x,
    y,
    time,
    valid: Number.isFinite(event.clientX) && Number.isFinite(event.clientY),
  };
}
