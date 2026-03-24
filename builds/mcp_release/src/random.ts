export interface RandomContext {
  seedUsed: string | null;
  random: () => number;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function createRandom(seed?: string | number): RandomContext {
  if (seed === undefined || seed === null) {
    return {
      seedUsed: null,
      random: Math.random,
    };
  }

  const normalizedSeed = String(seed);
  return {
    seedUsed: normalizedSeed,
    random: createLcg(hashSeed(normalizedSeed)),
  };
}

export function randomInt(random: () => number, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`Invalid randomInt range: min=${min} max=${max}`);
  }

  return Math.floor(random() * (max - min + 1)) + min;
}

