import type { IntentProfileCandidate, IntentProfileDescriptor, IntentProfileMatch } from "./types.js";

type ProfileResolutionResult = {
  match: IntentProfileMatch;
  candidates: IntentProfileCandidate[];
};

export function resolveWorkflowProfile(
  userMessage: string,
  descriptors: IntentProfileDescriptor[],
  threshold: number
): ProfileResolutionResult {
  const normalizedMessage = normalizeText(userMessage);
  const messageTokens = new Set<string>(tokenize(normalizedMessage));
  const candidates = descriptors.map((descriptor) => {
    const score = scoreDescriptor(normalizedMessage, messageTokens, descriptor);
    return {
      id: descriptor.id,
      score,
    };
  });

  candidates.sort((left, right) => right.score - left.score);

  const topCandidate = candidates[0];
  if (!topCandidate || topCandidate.score < threshold) {
    return {
      match: null,
      candidates,
    };
  }

  const descriptor = descriptors.find((item) => item.id === topCandidate.id);
  if (!descriptor) {
    return {
      match: null,
      candidates,
    };
  }

  return {
    match: {
      id: descriptor.id,
      confidence: topCandidate.score,
      source: descriptor.source,
    },
    candidates,
  };
}

function scoreDescriptor(message: string, messageTokens: Set<string>, descriptor: IntentProfileDescriptor): number {
  const descriptorTokens = new Set<string>(
    [
      descriptor.id,
      descriptor.name,
      descriptor.description,
      ...descriptor.tags,
      ...descriptor.aliases,
      descriptor.id.replace(/-/g, " "),
    ]
      .flatMap((value) => tokenize(value))
      .filter((token) => token.length > 0)
  );

  if (descriptorTokens.size === 0) {
    return 0;
  }

  let score = 0;
  const exactIdPhrase = descriptor.id.replace(/-/g, " ");
  if (message.includes(descriptor.id) || message.includes(exactIdPhrase)) {
    score += 0.5;
  }

  for (const alias of descriptor.aliases) {
    if (alias.length >= 3 && message.includes(alias)) {
      score += 0.12;
    }
  }

  if (message.includes(descriptor.name.toLowerCase())) {
    score += 0.2;
  }

  const overlapCount = countTokenOverlap(messageTokens, descriptorTokens);
  const overlapRatio = overlapCount / descriptorTokens.size;
  score += overlapRatio * 0.5;

  if (descriptor.source === "skills_memory") {
    score += 0.04;
  }

  if (descriptor.status === "archived") {
    score *= 0.6;
  }

  return clamp(score, 0, 1);
}

function countTokenOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
