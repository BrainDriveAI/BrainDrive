import type { IntentLayerConfig } from "./config.js";
import type { IntentProfileDescriptor } from "./types.js";
import type { SkillSummary } from "../memory/skills.js";

const BUILT_IN_PROFILES: IntentProfileDescriptor[] = [
  {
    id: "interview",
    name: "Interview",
    description: "Run requirement-elicitation interviews with adaptive follow-up questions.",
    tags: ["requirements", "questions", "discovery", "planning"],
    status: "active",
    aliases: [
      "interview me",
      "ask me questions",
      "clarify requirements",
      "requirement interview",
      "discovery interview",
    ],
    source: "built_in",
  },
  {
    id: "feature-spec",
    name: "Feature Spec",
    description: "Draft a structured feature specification with requirements and acceptance criteria.",
    tags: ["spec", "requirements", "design"],
    status: "active",
    aliases: ["feature spec", "specification", "write a spec", "requirements doc"],
    source: "built_in",
  },
  {
    id: "plan",
    name: "Plan",
    description: "Create a phased implementation or rollout plan.",
    tags: ["plan", "roadmap", "milestones", "rollout"],
    status: "active",
    aliases: ["implementation plan", "rollout plan", "roadmap", "project plan"],
    source: "built_in",
  },
  {
    id: "test-plan",
    name: "Test Plan",
    description: "Build a verification strategy and testing matrix.",
    tags: ["test", "qa", "verification"],
    status: "active",
    aliases: ["testing plan", "verification plan", "qa plan"],
    source: "built_in",
  },
  {
    id: "landscape",
    name: "Landscape",
    description: "Survey existing approaches, references, and implementation options.",
    tags: ["research", "survey", "comparison"],
    status: "active",
    aliases: ["landscape analysis", "research options", "compare approaches"],
    source: "built_in",
  },
];

export function buildIntentProfileRegistry(
  skills: SkillSummary[],
  config: IntentLayerConfig
): IntentProfileDescriptor[] {
  const includeSkills = config.profile_registry_sources.includes("skills_memory");
  const includeBuiltIn = config.profile_registry_sources.includes("built_in");
  const descriptors = new Map<string, IntentProfileDescriptor>();

  if (includeSkills) {
    for (const skill of skills) {
      const aliases = dedupeStrings([
        skill.id,
        skill.name,
        skill.id.replace(/-/g, " "),
        ...splitPhraseTokens(skill.name),
        ...splitPhraseTokens(skill.description),
        ...skill.tags,
        ...(config.profile_alias_overrides[skill.id] ?? []),
      ]);

      descriptors.set(skill.id, {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: [...skill.tags],
        status: skill.status,
        aliases,
        source: "skills_memory",
      });
    }
  }

  if (includeBuiltIn) {
    for (const descriptor of BUILT_IN_PROFILES) {
      const existing = descriptors.get(descriptor.id);
      if (existing) {
        const mergedAliases = dedupeStrings([
          ...existing.aliases,
          ...descriptor.aliases,
          ...(config.profile_alias_overrides[descriptor.id] ?? []),
        ]);
        descriptors.set(descriptor.id, {
          ...existing,
          aliases: mergedAliases,
        });
        continue;
      }

      descriptors.set(descriptor.id, {
        ...descriptor,
        aliases: dedupeStrings([
          ...descriptor.aliases,
          ...(config.profile_alias_overrides[descriptor.id] ?? []),
        ]),
      });
    }
  }

  for (const [profileId, aliases] of Object.entries(config.profile_alias_overrides)) {
    const descriptor = descriptors.get(profileId);
    if (!descriptor) {
      continue;
    }
    descriptors.set(profileId, {
      ...descriptor,
      aliases: dedupeStrings([...descriptor.aliases, ...aliases]),
    });
  }

  return [...descriptors.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function splitPhraseTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}
