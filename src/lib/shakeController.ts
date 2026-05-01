export const SHAKE_ACTIVE_THRESHOLD = 15;
export const SHAKE_REVEAL_THRESHOLD = 72;
export const SHAKE_MAX_ENERGY = 100;
export const SHAKE_DECAY_PER_SECOND = 22;

export interface ShakeController {
  addPointerVelocity: (velocity: number) => number;
  addMotionMagnitude: (magnitude: number) => number;
  decay: (seconds: number) => number;
  getEnergy: () => number;
  isActive: () => boolean;
  shouldReveal: () => boolean;
  reset: () => void;
}

export function createShakeController(initialEnergy = 0): ShakeController {
  let energy = clamp(initialEnergy, 0, SHAKE_MAX_ENERGY);

  const addEnergy = (amount: number) => {
    energy = clamp(energy + amount, 0, SHAKE_MAX_ENERGY);
    return energy;
  };

  return {
    addPointerVelocity(velocity: number) {
      return addEnergy(getPointerEnergyDelta(velocity));
    },
    addMotionMagnitude(magnitude: number) {
      return addEnergy(getMotionEnergyDelta(magnitude));
    },
    decay(seconds: number) {
      energy = clamp(energy - SHAKE_DECAY_PER_SECOND * Math.max(0, seconds), 0, SHAKE_MAX_ENERGY);
      return energy;
    },
    getEnergy() {
      return energy;
    },
    isActive() {
      return energy >= SHAKE_ACTIVE_THRESHOLD;
    },
    shouldReveal() {
      return energy >= SHAKE_REVEAL_THRESHOLD;
    },
    reset() {
      energy = 0;
    },
  };
}

export function getPointerEnergyDelta(velocity: number): number {
  return clamp((Math.max(0, velocity) - 250) / 35, 0, 18);
}

export function getMotionEnergyDelta(magnitude: number): number {
  return clamp((Math.max(0, magnitude) - 14) / 1.4, 0, 18);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
