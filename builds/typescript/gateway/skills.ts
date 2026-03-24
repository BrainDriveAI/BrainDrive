import { MemorySkillStore, normalizeSkillId, type SkillRecord, type SkillSummary } from "../memory/skills.js";

export type SkillActivationSource = "ui" | "slash" | "nl" | "api";

type SkillListEnvelope = {
  skills: SkillSummary[];
};

type SkillDetailEnvelope = {
  skill: SkillRecord;
};

type SkillCreateInput = {
  id?: string;
  name: string;
  description: string;
  content: string;
  tags?: string[];
};

type SkillUpdateInput = {
  name?: string;
  description?: string;
  content?: string;
  tags?: string[];
  status?: "active" | "archived";
};

export class GatewaySkillService {
  private readonly store: MemorySkillStore;

  constructor(memoryRoot: string) {
    this.store = new MemorySkillStore(memoryRoot);
  }

  async listSkills(): Promise<SkillListEnvelope> {
    return {
      skills: await this.store.list(),
    };
  }

  async getSkill(id: string): Promise<SkillDetailEnvelope | null> {
    const skill = await this.store.get(id);
    if (!skill) {
      return null;
    }

    return {
      skill,
    };
  }

  async createSkill(input: SkillCreateInput): Promise<SkillDetailEnvelope> {
    const skill = await this.store.create({
      id: input.id,
      name: input.name,
      description: input.description,
      content: input.content,
      tags: input.tags,
      scope: "global",
      status: "active",
    });

    return { skill };
  }

  async updateSkill(id: string, patch: SkillUpdateInput): Promise<SkillDetailEnvelope | null> {
    const skill = await this.store.update(id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      scope: "global",
    });
    if (!skill) {
      return null;
    }

    return { skill };
  }

  async deleteSkill(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async validateSkillIds(skillIds: string[]): Promise<{ valid: string[]; missing: string[] }> {
    const normalized = dedupeStrings(skillIds.map((value) => normalizeSkillId(value) ?? "").filter(Boolean));
    const valid: string[] = [];
    const missing: string[] = [];

    for (const skillId of normalized) {
      if (await this.store.exists(skillId)) {
        valid.push(skillId);
      } else {
        missing.push(skillId);
      }
    }

    return { valid, missing };
  }

  async composePromptWithSkills(
    basePrompt: string,
    skillIds: string[],
    maxSkillBytes = 64_000
  ): Promise<{
    prompt: string;
    applied: string[];
    missing: string[];
    truncated: boolean;
  }> {
    const resolved = await this.store.resolvePromptSkills(skillIds, maxSkillBytes);
    if (resolved.skills.length === 0) {
      return {
        prompt: basePrompt,
        applied: [],
        missing: resolved.missing,
        truncated: resolved.truncated,
      };
    }

    const skillSection = resolved.skills
      .map((skill) => `## skill:${skill.id}\n${skill.content.trim()}`)
      .join("\n\n");
    return {
      prompt: `${basePrompt.trim()}\n\n# Active Skills\n${skillSection}\n`,
      applied: resolved.skills.map((skill) => skill.id),
      missing: resolved.missing,
      truncated: resolved.truncated,
    };
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}
