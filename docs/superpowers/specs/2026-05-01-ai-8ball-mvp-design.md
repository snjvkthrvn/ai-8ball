# AI 8-Ball MVP Design

## Summary

Build a modern, minimalist decision app centered on a massive interactive 8-ball. The user asks a question by typing or using voice input. A local mock decision engine generates exactly three short contextual answers. The app does not reveal an answer immediately; the user must shake the 8-ball with the cursor, touch, or supported phone motion. Once enough shake energy is detected, one answer is randomly selected and revealed inside the ball.

The MVP should feel like a real-life magic 8-ball adapted for modern AI-style decision making, without using generic 8-ball phrases and without requiring an API key.

## Product Goals

- Make the first screen the actual app, not a landing page.
- Keep the interface quiet, modern, and minimal.
- Make the 8-ball the primary visual and interaction object.
- Support text input and voice input for the user's question.
- Generate three contextual mock answers from the question.
- Require a physical-feeling shake interaction before revealing the answer.
- Support desktop cursor shaking and mobile device-motion shaking.
- Keep the MVP frontend-only so the UI and interaction can be built before adding real AI.

## Non-Goals

- No real OpenAI or backend API call in the MVP.
- No account system, history sync, payments, or saved sessions.
- No generic 8-ball answer list as the main decision source.
- No spoken answer output.
- No full chat interface or multi-message assistant thread.

## Visual Direction

The visual direction is Quiet Oracle with toy-like physics.

The page should use a restrained black, white, and soft-gray palette. The background should be clean and spacious, with subtle depth rather than decorative gradients or busy effects. The 8-ball should be the only dramatic object: large, glossy, heavy, and tactile. The surrounding controls should feel like a precise modern tool: compact, readable, and unobtrusive. The prompt dock should anchor near the bottom center of the viewport with enough spacing that it never overlaps the ball on desktop or mobile.

The app should avoid generic AI visual tropes such as purple gradients, glowing chat cards, or assistant-style message bubbles. The prompt dock can sit near the bottom of the viewport, with a text field, submit action, and mic button. The result appears inside the 8-ball's answer window after shaking.

Toy-like physics should be visible but restrained. On first load, the ball should have a short weight-settling motion. In idle, it can have a subtle highlight drift or barely perceptible breathing shadow, but it should not constantly bounce. During pointer or touch interaction, the ball should tilt and translate a small amount toward the drag direction, then spring back with a damped settle. During shaking, rotation, highlight movement, and answer-window distortion should communicate energy buildup. After reveal, the ball should settle into stillness so the answer is easy to read.

## Core User Flow

1. The app opens to the 8-ball in an idle state and a compact prompt dock.
2. The user types a question or uses the mic button to dictate one.
3. The user submits the question.
4. The mock decision engine creates three contextual answer options.
5. The app enters a ready-to-shake state.
6. The user shakes the ball using cursor movement, touch movement, or device motion.
7. When shake energy crosses the reveal threshold, the app chooses one of the three options.
8. The ball settles and reveals the selected answer inside the answer window.
9. The user can ask another question and repeat the flow.

## Voice Input

Voice input should use the browser Web Speech API when available. Pressing the mic button starts listening and transcribes the user's speech into the prompt field. Voice input should not auto-submit; the user confirms with the same submit action used for typed questions. The MVP only needs voice input; it should not speak the final answer.

If speech recognition is unsupported, the mic button should become disabled or show a concise unavailable state. Text input remains the reliable fallback.

Voice input should expose four user-facing states:

- `notRequested`: speech recognition exists, but the user has not tried the mic in this session.
- `granted`: the browser allowed speech capture and recognition can start.
- `denied`: the browser or user blocked mic/speech access; keep typed input available and show the mic as unavailable.
- `unsupported`: the browser does not provide speech recognition; keep typed input available and show the mic as unavailable.

Browsers do not expose microphone permission state consistently for speech recognition, so `granted` can be inferred after recognition starts successfully. Permission errors should move the mic to `denied` for the current session.

## Shake Interaction

The app should normalize all shake sources into one shake energy value from `0` to `100`.

- Desktop: pointer drag or rapid cursor movement while interacting with the ball.
- Touch: touch drag movement on the ball.
- Mobile motion: device motion acceleration when the browser and permissions allow it.

The controller should cap energy at `100` and decay energy by about `22` points per second when movement slows. The app enters `shaking` once energy passes `15`. Reveal triggers at `72`, roughly equivalent to three hard shakes in about one second or sustained aggressive cursor shaking.

Pointer and touch movement should be converted from movement velocity into energy. A practical first-pass formula is:

- Compute pointer velocity in pixels per second from the latest movement delta.
- Add `clamp((velocity - 250) / 35, 0, 18)` to energy on each meaningful movement frame.

Device motion should use acceleration magnitude when available:

- Compute `sqrt(x*x + y*y + z*z)` from `DeviceMotionEvent.accelerationIncludingGravity`.
- Add `clamp((magnitude - 14) / 1.4, 0, 18)` to energy on each motion event.

These constants are starting values for the MVP. They should be easy to tune after browser testing without changing the state model.

The reveal should only happen after a submitted question has generated answers. Shaking the ball before a question can produce visual wobble, but it should not reveal an answer.

On mobile browsers that require motion permission, the app should request permission at the point where shaking becomes relevant. If permission is denied or unsupported, touch shaking remains available.

## State Model

The app should use a small explicit state model:

- `idle`: no active question.
- `listening`: voice input is active.
- `readyToShake`: a question has been submitted and three answers are ready.
- `shaking`: shake energy is increasing.
- `revealing`: the selected answer is being animated into view.
- `answered`: the final answer is visible.

The state model should prevent duplicate reveals, empty submissions, and answer reveals before options exist.

After `answered`, the prompt dock should offer a clear new-question path. The field is re-enabled, and starting a new question clears the previous options, resets shake energy to `0`, hides the answer window text, and returns the app to `idle`. During `readyToShake`, `shaking`, and `revealing`, the prompt field and submit action should be visually disabled or read-only so ignored submissions are not silent.

## Mock Decision Engine

The mock engine receives the user's question and returns exactly three short contextual answers. For the MVP, the engine should use hardcoded local heuristics rather than pretending to be real AI. It should be deterministic for the same prompt so it is testable, while the final revealed answer remains randomly selected from the three generated options.

The engine should:

1. Normalize the prompt by trimming whitespace, lowercasing, and removing repeated punctuation.
2. Detect the question shape:
   - `yesNo`: starts with words like "should", "can", "do", "does", "is", "are", "will", or "would".
   - `timing`: contains "when", "today", "tomorrow", "this week", "friday", "wait", or "now".
   - `comparison`: contains " or ", " vs ", "versus", "better", or "which".
   - `openAction`: starts with "how", "what", or otherwise reads like a general decision prompt.
3. Detect one primary topic using keyword groups:
   - `relationship`: "date", "ask out", "text her", "text him", "friend", "crush", "break up".
   - `money`: "buy", "spend", "cost", "save", "invest", "job offer", "salary".
   - `work`: "apply", "project", "ship", "launch", "study", "school", "class", "career".
   - `risk`: "quit", "move", "risk", "confront", "fight", "leave", "commit".
   - `general`: fallback when no group matches.
4. Return three answers that represent distinct decision stances:
   - one action-forward answer.
   - one wait-or-gather-more-information answer.
   - one caution-or-smaller-step answer.
5. Keep each answer short, preferably under 12 words and never more than one sentence.

The engine may use a small prompt hash to rotate between a few templates inside each topic group. It should not output long paragraphs, generic fortunes, or obvious filler. The later real AI route should preserve the same frontend contract: `{ options: string[] }`.

Example answer style:

- "Ask her out."
- "Wait until Friday."
- "The risk is not worth it."
- "Do the smaller version first."
- "Send the message, but keep it short."

## Component Boundaries

- `App`: owns high-level state and connects input, generator, and ball.
- `DecisionInput`: renders the prompt dock, text input, submit action, mic button, and voice state.
- `EightBall`: renders the ball, answer window, interaction surface, and reveal animation.
- `mockDecisionEngine`: converts a prompt into three local answer options.
- `shakeController`: converts pointer, touch, and device motion into normalized shake energy.
- `speechInput`: wraps browser speech recognition feature detection and events.

These boundaries keep the visual component separate from decision generation, speech recognition, and motion handling.

## Error And Fallback Behavior

- Empty prompt: keep focus in the input and do not enter ready-to-shake state.
- Unsupported speech recognition: keep text input available and disable or soften the mic action.
- Speech recognition error: stop listening and leave the current typed text intact.
- Unsupported device motion: use pointer and touch shaking.
- Motion permission denied: use touch shaking.
- Repeated submit while answering: prevent confusion by disabling or locking submit during `readyToShake`, `shaking`, and `revealing`; from `answered`, require the new-question path before accepting a new submission.

## Testing And Verification

Automated checks should cover:

- Mock engine returns exactly three non-empty answer strings.
- Empty submissions do not generate options.
- Shake threshold does not reveal before `readyToShake`.
- Shake threshold selects one of the generated options.
- State transitions are valid across text submission, voice fallback, shake, reveal, and reset.

Browser verification should cover:

- Desktop viewport: the ball is visually dominant and the prompt dock does not overlap it.
- Mobile viewport: the ball remains usable, the prompt dock fits, and touch shaking works.
- Unsupported voice and motion paths remain usable through text and touch.
- Cursor and touch shaking feel reachable without accidental instant reveal.
- The threshold requires several intentional shakes and reveals exactly once.
- The answered-to-idle reset path is obvious and works without stale answer text.
- Voice input fills the prompt and waits for explicit submit.
- Mobile Safari permission paths are checked manually when hardware is available, especially speech input and device motion permission.

## Future AI Upgrade

The real AI version should preserve the same frontend contract by replacing `mockDecisionEngine` with a backend route that returns exactly three short contextual answer options. This keeps the MVP interaction, visual design, and state model stable while swapping the answer source later.
