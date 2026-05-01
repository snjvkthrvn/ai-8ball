import { describe, expect, it } from 'vitest';
import {
  SHAKE_ACTIVE_THRESHOLD,
  SHAKE_REVEAL_THRESHOLD,
  createShakeController,
  getMotionEnergyDelta,
  getPointerEnergyDelta,
} from './shakeController';

describe('shakeController', () => {
  it('starts at zero and does not reveal before threshold', () => {
    const controller = createShakeController();

    expect(controller.getEnergy()).toBe(0);
    expect(controller.isActive()).toBe(false);
    expect(controller.shouldReveal()).toBe(false);
  });

  it('converts pointer velocity into capped energy', () => {
    expect(getPointerEnergyDelta(100)).toBe(0);
    expect(getPointerEnergyDelta(600)).toBeGreaterThan(0);
    expect(getPointerEnergyDelta(2400)).toBeLessThanOrEqual(18);
  });

  it('converts device acceleration magnitude into capped energy', () => {
    expect(getMotionEnergyDelta(8)).toBe(0);
    expect(getMotionEnergyDelta(18)).toBeGreaterThan(0);
    expect(getMotionEnergyDelta(60)).toBeLessThanOrEqual(18);
  });

  it('crosses active and reveal thresholds after intentional shakes', () => {
    const controller = createShakeController();

    controller.addPointerVelocity(1000);
    expect(controller.getEnergy()).toBeGreaterThan(SHAKE_ACTIVE_THRESHOLD);
    expect(controller.isActive()).toBe(true);
    expect(controller.shouldReveal()).toBe(false);

    controller.addPointerVelocity(2400);
    controller.addPointerVelocity(2400);
    controller.addPointerVelocity(2400);
    controller.addPointerVelocity(2400);

    expect(controller.getEnergy()).toBeGreaterThanOrEqual(SHAKE_REVEAL_THRESHOLD);
    expect(controller.shouldReveal()).toBe(true);
  });

  it('decays energy over time and never drops below zero', () => {
    const controller = createShakeController();

    controller.addMotionMagnitude(50);
    controller.decay(10);

    expect(controller.getEnergy()).toBe(0);
    expect(controller.isActive()).toBe(false);
  });

  it('resets energy to zero', () => {
    const controller = createShakeController();

    controller.addPointerVelocity(2000);
    controller.reset();

    expect(controller.getEnergy()).toBe(0);
  });
});
