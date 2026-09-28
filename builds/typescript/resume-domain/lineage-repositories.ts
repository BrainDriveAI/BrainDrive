import {
  ArtifactRecordSchema,
  ExportReceiptRecordSchema,
  JobDescriptionRecordSchema,
  ResumeDefinitionRecordSchema,
  TailoredVariantRecordSchema,
} from "../app-platform/contracts/data.js";
import { ResumeDomainError } from "./errors.js";
import { buildResumeLineageGraph, inboundLineageEdges, type LineageRecord } from "./resume-lineage.js";
import { ResumeDataStore } from "./store.js";

export class ResumeDefinitionRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async requireRevision(revisionId: string, scopes: readonly string[] = []) {
    const record = await this.store.readRevision(revisionId, scopes);
    const parsed = ResumeDefinitionRecordSchema.safeParse(record);
    if (!parsed.success) throw new ResumeDomainError("not_found_within_scope", "Resume definition was not found within the granted scope", 404);
    return parsed.data;
  }

  async requireHead(recordId: string, scopes: readonly string[] = []) {
    const record = await this.store.readHead(recordId, scopes);
    const parsed = ResumeDefinitionRecordSchema.safeParse(record);
    if (!parsed.success) throw new ResumeDomainError("not_found_within_scope", "Resume definition was not found within the granted scope", 404);
    return parsed.data;
  }
}

export class ResumeJobRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async requireRevision(revisionId: string, scopes: readonly string[] = []) {
    const parsed = JobDescriptionRecordSchema.safeParse(await this.store.readRevision(revisionId, scopes));
    if (!parsed.success) throw new ResumeDomainError("not_found_within_scope", "Job snapshot was not found within the granted scope", 404);
    return parsed.data;
  }
}

export class TailoredVariantRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async forTargetedDefinition(revisionId: string, scopes: readonly string[] = []) {
    const records = await this.allRecords(scopes);
    const variants = records.filter((record) => record.record_type === "tailored_variant" && record.targeted_definition_revision_id === revisionId);
    const current = variants.sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
    if (!current) throw new ResumeDomainError("validation_failed", "Targeted definition is missing tailored evidence lineage", 409);
    return TailoredVariantRecordSchema.parse(current);
  }

  private async allRecords(scopes: readonly string[]): Promise<LineageRecord[]> {
    return this.store.allRevisions(scopes);
  }
}

export class ResumeArtifactRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async requireRevision(revisionId: string, scopes: readonly string[] = []) {
    const parsed = ArtifactRecordSchema.safeParse(await this.store.readRevision(revisionId, scopes));
    if (!parsed.success) throw new ResumeDomainError("not_found_within_scope", "Artifact metadata was not found within the granted scope", 404);
    return parsed.data;
  }
}

export class ResumeExportRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async requireRevision(revisionId: string, scopes: readonly string[] = []) {
    const parsed = ExportReceiptRecordSchema.safeParse(await this.store.readRevision(revisionId, scopes));
    if (!parsed.success) throw new ResumeDomainError("not_found_within_scope", "Export receipt was not found within the granted scope", 404);
    return parsed.data;
  }
}

export class ResumeReferenceRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async records(scopes: readonly string[] = []): Promise<LineageRecord[]> {
    return this.store.allRevisions(scopes);
  }

  async graph(scopes: readonly string[] = []) {
    return buildResumeLineageGraph(await this.records(scopes));
  }

  async assertNoInboundReferences(revisionId: string, scopes: readonly string[] = []): Promise<void> {
    const graph = await this.graph(scopes);
    if (inboundLineageEdges(graph, revisionId).length > 0) {
      throw new ResumeDomainError("conflict", "Record is retained by immutable lineage references", 409);
    }
  }
}
