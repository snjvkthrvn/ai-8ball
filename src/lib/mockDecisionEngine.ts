type QuestionShape = 'yesNo' | 'timing' | 'comparison' | 'openAction';
type Topic = 'relationship' | 'money' | 'work' | 'risk' | 'general';
type Stance = 'action' | 'wait' | 'caution';

const SHAPE_MATCHERS: Array<[QuestionShape, RegExp]> = [
  ['timing', /\b(when|today|tomorrow|this week|friday|wait|now)\b/],
  ['comparison', /\b(or|vs|versus|better|which)\b/],
  ['yesNo', /^(should|can|do|does|is|are|will|would)\b/],
  ['openAction', /^(how|what)\b/],
];

const TOPIC_MATCHERS: Array<[Topic, RegExp]> = [
  ['relationship', /\b(date|ask out|text her|text him|text them|friend|crush|break up)\b/],
  ['money', /\b(buy|spend|cost|save|invest|job offer|salary|tickets?)\b/],
  ['work', /\b(apply|project|ship|launch|study|school|class|career|react|vue)\b/],
  ['risk', /\b(quit|move|risk|confront|fight|leave|commit)\b/],
];

const ANSWERS: Record<Topic, Record<Stance, string[]>> = {
  relationship: {
    action: ['Send the message, but keep it short.', 'Be honest and ask directly.', 'Message them with low pressure.'],
    wait: ['Wait until the conversation feels warmer.', 'Give it one more day.', 'Read the room before sending it.'],
    caution: ['Keep it simple, not intense.', 'Do not force the answer tonight.', 'Choose clarity over chasing a reaction.'],
  },
  money: {
    action: ['Buy it if it fits the plan.', 'Take the deal, but set a limit.', 'Choose the option with less regret.'],
    wait: ['Wait until the price cools off.', 'Sleep on it before spending.', 'Compare the real cost first.'],
    caution: ['The risk is not worth it.', 'Do the cheaper version first.', 'Protect your cash this time.'],
  },
  work: {
    action: ['Apply now and refine later.', 'Ship the smaller version first.', 'Pick one path and start today.'],
    wait: ['Test it once before committing.', 'Wait until the details are clearer.', 'Ask one more informed person.'],
    caution: ['Do the smaller version first.', 'Avoid turning this into a huge bet.', 'Cut scope before adding pressure.'],
  },
  risk: {
    action: ['Take the controlled risk.', 'Say it clearly and calmly.', 'Commit only if you can own it.'],
    wait: ['Wait until emotions settle.', 'Gather one more real signal.', 'Give the decision another night.'],
    caution: ['The risk is not worth it.', 'Choose the reversible move.', 'Do not burn the bridge yet.'],
  },
  general: {
    action: ['Do the smaller version first.', 'Pick the option you can start today.', 'Make the cleanest next move.'],
    wait: ['Wait until Friday.', 'Get one more signal first.', 'Pause until the choice feels less noisy.'],
    caution: ['The risk is not worth it.', 'Choose the reversible option.', 'Keep it simple this round.'],
  },
};

export function createMockDecisionOptions(prompt: string): string[] {
  const normalized = normalizePrompt(prompt);

  if (!normalized) {
    return [];
  }

  const shape = detectQuestionShape(normalized);
  const topic = detectTopic(normalized);
  const seed = hashPrompt(`${shape}:${topic}:${normalized}`);

  return (['action', 'wait', 'caution'] as const).map((stance, index) => {
    const options = getStanceOptions(topic, shape, stance);
    return options[(seed + index) % options.length];
  });
}

function normalizePrompt(prompt: string): string {
  return prompt
    .trim()
    .toLowerCase()
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function detectQuestionShape(prompt: string): QuestionShape {
  const match = SHAPE_MATCHERS.find(([, matcher]) => matcher.test(prompt));
  return match?.[0] ?? 'openAction';
}

function detectTopic(prompt: string): Topic {
  const match = TOPIC_MATCHERS.find(([, matcher]) => matcher.test(prompt));
  return match?.[0] ?? 'general';
}

function getStanceOptions(topic: Topic, shape: QuestionShape, stance: Stance): string[] {
  if (shape === 'comparison' && stance === 'action') {
    return ['Pick one and test it.', 'Choose the cleaner option.', 'Go with the easier start.'];
  }

  if (shape === 'timing' && stance === 'wait') {
    return ['Wait until Friday.', 'Give it one more day.', 'Let the timing improve first.'];
  }

  return ANSWERS[topic][stance];
}

function hashPrompt(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}
