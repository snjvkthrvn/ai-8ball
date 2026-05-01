import { describe, expect, it } from 'vitest';
import { createMockDecisionOptions } from './mockDecisionEngine';

describe('createMockDecisionOptions', () => {
  it('returns no options for an empty prompt', () => {
    expect(createMockDecisionOptions('   ')).toEqual([]);
  });

  it('returns exactly three short answers for a decision prompt', () => {
    const options = createMockDecisionOptions('Should I apply for the job today?');

    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option.length).toBeGreaterThan(0);
      expect(option.split(/\s+/).length).toBeLessThanOrEqual(12);
      expect(option).toMatch(/[.!?]$/);
    }
  });

  it('uses relationship-specific language for relationship prompts', () => {
    const options = createMockDecisionOptions('Should I text her tonight?');

    expect(options.join(' ').toLowerCase()).toMatch(/text|message|her|them|honest|short/);
  });

  it('is deterministic for the same prompt', () => {
    const first = createMockDecisionOptions('Buy the tickets now or wait?');
    const second = createMockDecisionOptions('Buy the tickets now or wait?');

    expect(second).toEqual(first);
  });

  it('keeps comparison answers distinct across decision stances', () => {
    const options = createMockDecisionOptions('Should I pick React or Vue for this app?');

    expect(new Set(options).size).toBe(3);
    expect(options.join(' ').toLowerCase()).toMatch(/pick|compare|smaller|wait|test/);
  });
});
