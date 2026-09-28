import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalInputDigest, canonicalJson } from "../app-platform/contracts/common.js";
import {
  ApproveBriefInputSchema,
  BriefCatalogSchema,
  BriefDraftRevisionSchema,
  BriefSourceRevisionSchema,
  SaveBriefDraftInputSchema,
  SaveBriefSourceInputSchema,
  type ApprovedBriefRevision,
  type BriefCatalog,
  type BriefDraftRevision,
  type BriefSourceRevision,
} from "./contracts.js";
import { BriefDomainError } from "./errors.js";
import { validateBriefGrounding } from "./grounding.js";

type StoreHooks = { beforeCommit?: () => Promise<void> };

function seal(body: Omit<BriefCatalog, "integrity_digest">): BriefCatalog {
  const normalized = BriefCatalogSchema.parse({ ...body, integrity_digest: `sha256:${"0".repeat(64)}` });
  const { integrity_digest: _ignored, ...normalizedBody } = normalized;
  return BriefCatalogSchema.parse({ ...normalizedBody, integrity_digest: canonicalInputDigest(normalizedBody) });
}

function verify(raw: unknown): BriefCatalog {
  const catalog = BriefCatalogSchema.parse(raw);
  const { integrity_digest: observed, ...body } = catalog;
  if (canonicalInputDigest(body) !== observed) throw new BriefDomainError("validation_failed", "Brief Builder catalog integrity validation failed");
  return catalog;
}

export class BriefDataStore {
  readonly catalogPath: string;
  #tail = Promise.resolve();

  constructor(readonly memoryRoot: string, readonly namespaceRoot = path.join(memoryRoot, "apps", "brief-builder"), private readonly hooks: StoreHooks = {}) {
    const expected = path.resolve(memoryRoot, "apps", "brief-builder");
    if (path.resolve(namespaceRoot) !== expected) throw new BriefDomainError("denied", "Brief Builder namespace must be host-derived", 403);
    this.catalogPath = path.join(namespaceRoot, "catalog.json");
  }

  async initialize(ownerId: string): Promise<BriefCatalog> {
    return this.exclusive(async () => {
      await mkdir(this.namespaceRoot, { recursive: true, mode: 0o700 });
      try { return await this.read(); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        const initial = seal({ catalog_version: 1, data_schema_version: 1, app_id: "ai.braindrive.brief-builder", owner_id: ownerId, revision: 0, sources: [], drafts: [], approved: [], operations: [] });
        await this.commit(initial);
        return initial;
      }
    });
  }

  async catalog(): Promise<BriefCatalog> { return this.read(); }

  async saveSource(raw: unknown): Promise<BriefSourceRevision> {
    const input = SaveBriefSourceInputSchema.parse(raw);
    return this.mutate(input.idempotency_key, { kind: "source", text: input.text }, input.expected_catalog_revision, (catalog) => {
      const source = BriefSourceRevisionSchema.parse({ source_revision_id: input.source_revision_id ?? randomUUID(), revision: catalog.sources.length + 1, text: input.text, content_digest: canonicalInputDigest(input.text), created_at: new Date().toISOString() });
      return { result: source, catalog: { ...catalog, sources: [...catalog.sources, source] } };
    });
  }

  async saveDraft(raw: unknown): Promise<BriefDraftRevision> {
    const input = SaveBriefDraftInputSchema.parse(raw);
    return this.mutate(input.idempotency_key, { kind: "draft", source_revision_id: input.source_revision_id, title: input.title, statements: input.statements, generated_by: input.generated_by }, input.expected_catalog_revision, (catalog) => {
      const source = catalog.sources.find((item) => item.source_revision_id === input.source_revision_id);
      if (!source) throw new BriefDomainError("not_found", "Brief source revision is unavailable", 404);
      const grounding = validateBriefGrounding(source.text, input.statements);
      if (!grounding.accepted) throw new BriefDomainError("validation_failed", "Brief statements are not grounded in owner source or labeled owner context");
      const content = { title: input.title, statements: input.statements };
      const draft = BriefDraftRevisionSchema.parse({ draft_revision_id: randomUUID(), source_revision_id: source.source_revision_id, revision: catalog.drafts.length + 1, ...content, content_digest: canonicalInputDigest(content), generated_by: input.generated_by, created_at: new Date().toISOString() });
      return { result: draft, catalog: { ...catalog, drafts: [...catalog.drafts, draft] } };
    });
  }

  async approve(raw: unknown): Promise<ApprovedBriefRevision> {
    const input = ApproveBriefInputSchema.parse(raw);
    return this.mutate(input.idempotency_key, { kind: "approved", draft_revision_id: input.draft_revision_id, proof_id: input.owner_confirmation_proof_id }, input.expected_catalog_revision, (catalog) => {
      const draft = catalog.drafts.find((item) => item.draft_revision_id === input.draft_revision_id);
      if (!draft) throw new BriefDomainError("not_found", "Brief draft revision is unavailable", 404);
      const source = catalog.sources.find((item) => item.source_revision_id === draft.source_revision_id)!;
      if (!validateBriefGrounding(source.text, draft.statements).accepted) throw new BriefDomainError("validation_failed", "Brief draft no longer passes grounding validation");
      const predecessor = catalog.approved.at(-1) ?? null;
      const content = { title: draft.title, statements: draft.statements };
      const approved: ApprovedBriefRevision = {
        approved_revision_id: randomUUID(), source_revision_id: draft.source_revision_id, draft_revision_id: draft.draft_revision_id,
        revision: catalog.approved.length + 1, predecessor_revision_id: predecessor?.approved_revision_id ?? null,
        ...content, content_digest: canonicalInputDigest(content), owner_confirmation_proof_id: input.owner_confirmation_proof_id,
        approved_at: new Date().toISOString(),
      };
      return { result: approved, catalog: { ...catalog, approved: [...catalog.approved, approved] } };
    });
  }

  async reopen(): Promise<{ source: BriefSourceRevision | null; draft: BriefDraftRevision | null; approved: ApprovedBriefRevision | null }> {
    const catalog = await this.read();
    return { source: catalog.sources.at(-1) ?? null, draft: catalog.drafts.at(-1) ?? null, approved: catalog.approved.at(-1) ?? null };
  }

  async lineage(approvedRevisionId: string): Promise<{ revision: ApprovedBriefRevision; predecessor: ApprovedBriefRevision | null; successor: ApprovedBriefRevision | null }> {
    const catalog = await this.read();
    const revision = catalog.approved.find((item) => item.approved_revision_id === approvedRevisionId);
    if (!revision) throw new BriefDomainError("not_found", "Approved brief revision is unavailable", 404);
    return {
      revision,
      predecessor: revision.predecessor_revision_id ? catalog.approved.find((item) => item.approved_revision_id === revision.predecessor_revision_id) ?? null : null,
      successor: catalog.approved.find((item) => item.predecessor_revision_id === revision.approved_revision_id) ?? null,
    };
  }

  private async mutate<T extends { source_revision_id?: string; draft_revision_id?: string; approved_revision_id?: string }>(idempotencyKey: string, canonicalInput: unknown, expectedRevision: number, action: (catalog: BriefCatalog) => { result: T; catalog: BriefCatalog }): Promise<T> {
    return this.exclusive(async () => {
      const catalog = await this.read();
      const inputDigest = canonicalInputDigest(canonicalInput);
      const prior = catalog.operations.find((item) => item.idempotency_key === idempotencyKey);
      if (prior) {
        if (prior.input_digest !== inputDigest) throw new BriefDomainError("conflict", "Brief operation identity was reused with changed input");
        const collection = prior.result_kind === "source" ? catalog.sources : prior.result_kind === "draft" ? catalog.drafts : catalog.approved;
        return collection.find((item) => Object.values(item).includes(prior.result_revision_id)) as unknown as T;
      }
      if (catalog.revision !== expectedRevision) throw new BriefDomainError("conflict", "Brief catalog changed; refresh before saving");
      const { result, catalog: changed } = action(catalog);
      const resultKind = "approved_revision_id" in result ? "approved" : "draft_revision_id" in result ? "draft" : "source";
      const resultId = resultKind === "source" ? result.source_revision_id! : resultKind === "draft" ? result.draft_revision_id! : result.approved_revision_id!;
      const next = seal({ ...changed, revision: catalog.revision + 1, operations: [...catalog.operations, { idempotency_key: idempotencyKey, input_digest: inputDigest, result_kind: resultKind, result_revision_id: resultId }] });
      await this.commit(next);
      return result;
    });
  }

  private async read(): Promise<BriefCatalog> { return verify(JSON.parse(await readFile(this.catalogPath, "utf8"))); }

  private async commit(catalog: BriefCatalog): Promise<void> {
    const temporary = `${this.catalogPath}.${randomUUID()}.tmp`;
    try {
      await this.hooks.beforeCommit?.();
      await writeFile(temporary, `${canonicalJson(catalog)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, this.catalogPath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof BriefDomainError) throw error;
      throw new BriefDomainError("persistence_failed", "Brief Builder owner data could not be saved safely", 500);
    }
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const prior = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try { return await action(); } finally { release(); }
  }
}
