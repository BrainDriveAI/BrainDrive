import { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import {
  LineageGraphSchema,
  JobEvidenceValueSchema,
  ResumeDataRecordSchema,
  type ResumeDefinitionRecordSchema,
  type ResumeStatementSchema,
} from "../app-platform/contracts/data.js";
import { ResumeDomainError } from "./errors.js";

export type LineageRecord = z.infer<typeof ResumeDataRecordSchema>;
export type ResumeDefinition = z.infer<typeof ResumeDefinitionRecordSchema>;
type ResumeStatement = z.infer<typeof ResumeStatementSchema>;
export type ResumeLineageGraph = z.infer<typeof LineageGraphSchema>;
export type LineageEdge = ResumeLineageGraph["edges"][number];

const sensitivityRank = { standard: 0, sensitive: 1, highly_sensitive: 2 } as const;

export function buildResumeLineageGraph(rawRecords: readonly LineageRecord[]): ResumeLineageGraph {
  const records = rawRecords.map((record) => ResumeDataRecordSchema.parse(record));
  const byRevision = new Map<string, LineageRecord>();
  for (const record of records) {
    if (byRevision.has(record.metadata.revision_id)) fail("Resume lineage contains a duplicate revision identity");
    byRevision.set(record.metadata.revision_id, record);
  }

  const edges: LineageEdge[] = [];
  const edge = (from: LineageRecord, toRevisionId: string, relation: LineageEdge["relation"], expectedType?: LineageRecord["record_type"]): LineageRecord => {
    const target = byRevision.get(toRevisionId);
    if (!target || (expectedType && target.record_type !== expectedType)) fail("Resume lineage reference does not resolve to the required record type");
    edges.push({ from_revision_id: from.metadata.revision_id, to_revision_id: toRevisionId, relation });
    return target;
  };
  const derivative = (from: LineageRecord, to: LineageRecord) => {
    if (sensitivityRank[from.sensitivity] < sensitivityRank[to.sensitivity]) fail("Resume derivative sensitivity is lower than its supporting record");
  };

  for (const record of records) {
    if (record.metadata.prior_revision_id) {
      const prior = edge(record, record.metadata.prior_revision_id, "derived_from");
      if (prior.metadata.record_id !== record.metadata.record_id || prior.record_type !== record.record_type || prior.metadata.revision >= record.metadata.revision) {
        fail("Resume immutable predecessor lineage is invalid");
      }
      derivative(record, prior);
    }

    switch (record.record_type) {
      case "source":
      case "job_description":
      case "migration":
        break;
      case "interview_progress": {
        if (record.active_job_fact_revision_id) {
          const job = edge(record, record.active_job_fact_revision_id, "supported_by", "career_fact");
          if (job.record_type !== "career_fact" || job.fact_kind !== "employment" || job.state !== "confirmed" || job.owner_id !== record.owner_id) {
            fail("Interview progress job slot must resolve to one confirmed same-owner employment fact");
          }
        }
        if (record.last_submitted_turn_revision_id) edge(record, record.last_submitted_turn_revision_id, "derived_from", "source");
        break;
      }
      case "career_fact": {
        for (const sourceRevisionId of record.source_revision_ids) derivative(record, edge(record, sourceRevisionId, "derived_from", "source"));
        if (record.supersedes_fact_revision_id) {
          const prior = byRevision.get(record.supersedes_fact_revision_id);
          if (!prior || prior.record_type !== "career_fact" || prior.metadata.record_id !== record.metadata.record_id) fail("Career fact supersession lineage is invalid");
        }
        if (record.fact_kind === "job_evidence") {
          const evidence = JobEvidenceValueSchema.parse(JSON.parse(record.value));
          if (evidence.job_fact_revision_id) {
            const jobFact = edge(record, evidence.job_fact_revision_id, "supported_by", "career_fact");
            if (jobFact.record_type !== "career_fact" || jobFact.fact_kind !== "employment" || jobFact.state !== "confirmed" || jobFact.owner_id !== record.owner_id) {
              fail("Job evidence must resolve to one confirmed same-owner employment fact");
            }
          }
        }
        break;
      }
      case "resume_definition": {
        validateStatementStructure(record.statements);
        const statementSupport = unique(record.statements.flatMap((statement) => statement.supporting_confirmed_fact_revision_ids));
        if (record.definition_kind === "general" && !sameSet(statementSupport, record.selected_fact_revision_ids)) {
          fail("General definition selected facts must exactly match factual statement support");
        }
        if (statementSupport.some((revisionId) => !record.selected_fact_revision_ids.includes(revisionId))) {
          fail("Definition statement support is absent from its selected fact snapshot");
        }
        for (const factRevisionId of record.selected_fact_revision_ids) {
          const fact = edge(record, factRevisionId, "supported_by", "career_fact");
          if (fact.record_type !== "career_fact" || fact.state !== "confirmed") fail("Approved resume support must resolve to confirmed fact revisions");
          derivative(record, fact);
        }
        if (record.parent_definition_revision_id) {
          const parent = edge(record, record.parent_definition_revision_id, "parent", "resume_definition");
          if (parent.record_type !== "resume_definition" || parent.definition_kind !== "general") fail("Definition parent must resolve to a general resume revision");
          if (record.definition_kind === "targeted" && parent.status !== "approved") fail("Targeted definition parent must be an approved general resume revision");
          derivative(record, parent);
        }
        if (record.job_revision_id) derivative(record, edge(record, record.job_revision_id, "job_snapshot", "job_description"));
        if (record.successor_context) {
          const source = edge(record, record.successor_context.source_definition_revision_id, "derived_from", "resume_definition");
          if (source.record_type !== "resume_definition" || source.owner_id !== record.owner_id) fail("Definition successor source must remain owner scoped");
          derivative(record, source);
          if (record.successor_context.kind === "natural_language_revision") {
            const requestId = record.successor_context.revision_request_revision_id;
            if (!requestId) fail("Natural-language successor requires its immutable revision request");
            const request = edge(record, requestId, "derived_from", "resume_revision_request");
            if (request.record_type !== "resume_revision_request" || request.source_definition_revision_id !== source.metadata.revision_id || request.state !== "generating") {
              fail("Natural-language successor request lineage is invalid");
            }
            derivative(record, request);
          }
        }
        break;
      }
      case "tailored_variant": {
        const parent = edge(record, record.parent_general_definition_revision_id, "parent", "resume_definition");
        const targeted = edge(record, record.targeted_definition_revision_id, "derived_from", "resume_definition");
        const job = edge(record, record.job_revision_id, "job_snapshot", "job_description");
        if (
          parent.record_type !== "resume_definition" || parent.definition_kind !== "general" ||
          targeted.record_type !== "resume_definition" || targeted.definition_kind !== "targeted" ||
          targeted.parent_definition_revision_id !== parent.metadata.revision_id ||
          targeted.job_revision_id !== job.metadata.revision_id
        ) fail("Tailored variant parent, targeted definition, and job lineage disagree");
        const requirementIds = record.evidence_matrix.map((item) => item.requirement_id);
        if (new Set(requirementIds).size !== requirementIds.length) fail("Tailored evidence contains duplicate requirement identities");
        const evidenceFactIds = unique(record.evidence_matrix.flatMap((item) => item.supporting_confirmed_fact_revision_ids));
        for (const factRevisionId of evidenceFactIds) {
          const fact = edge(record, factRevisionId, "supported_by", "career_fact");
          if (fact.record_type !== "career_fact" || fact.state !== "confirmed") fail("Tailored evidence must resolve to confirmed fact revisions");
          derivative(record, fact);
        }
        const expectedSelected = unique([...targeted.statements.flatMap((statement) => statement.supporting_confirmed_fact_revision_ids), ...evidenceFactIds]);
        if (!sameSet(expectedSelected, targeted.selected_fact_revision_ids)) fail("Targeted definition selected facts must exactly match statement and evidence support");
        const expectedChanged = changedStatementIds(parent.statements, targeted.statements);
        if (new Set(record.changed_statement_ids).size !== record.changed_statement_ids.length || !sameSet(expectedChanged, record.changed_statement_ids)) {
          fail("Tailored changed-statement metadata does not match its immutable parent comparison");
        }
        derivative(record, parent);
        derivative(record, targeted);
        derivative(record, job);
        break;
      }
      case "artifact": {
        const definition = edge(record, record.definition_revision_id, "rendered_from", "resume_definition");
        if (definition.record_type !== "resume_definition") fail("Artifact definition lineage is invalid");
        if (record.accepted) {
          if (
            definition.status !== "approved" || !definition.approval_evidence ||
            record.template_id !== definition.template_id || record.template_version !== definition.template_version ||
            record.validation_run_id !== definition.approval_evidence.validation_run_id ||
            canonicalInputDigest(record.findings) !== definition.approval_evidence.findings_digest
          ) fail("Accepted artifact compatibility and validation lineage is invalid");
        }
        derivative(record, definition);
        break;
      }
      case "export_receipt": {
        const artifact = edge(record, record.artifact_revision_id, "exported_from", "artifact");
        if (artifact.record_type !== "artifact" || !artifact.accepted || artifact.artifact_digest !== record.artifact_digest || artifact.format !== record.format) {
          fail("Export receipt artifact lineage is invalid");
        }
        derivative(record, artifact);
        break;
      }
      case "resume_revision_request": {
        const source = edge(record, record.source_definition_revision_id, "revision_source", "resume_definition");
        if (source.owner_id !== record.owner_id) fail("Revision request source must remain owner scoped");
        if (record.resulting_definition_revision_id) {
          const result = edge(record, record.resulting_definition_revision_id, "resulted_in", "resume_definition");
          const context = result.record_type === "resume_definition" ? result.successor_context : null;
          const instruction = context?.revision_request_revision_id ? byRevision.get(context.revision_request_revision_id) : null;
          if (
            result.owner_id !== record.owner_id || result.record_type !== "resume_definition" ||
            context?.kind !== "natural_language_revision" ||
            context.source_definition_revision_id !== source.metadata.revision_id ||
            instruction?.record_type !== "resume_revision_request" ||
            instruction.metadata.record_id !== record.metadata.record_id ||
            instruction.state !== "generating"
          ) {
            fail("Revision request result must be an owner-scoped successor definition");
          }
        }
        break;
      }
    }
  }

  const targetedRevisionIds = new Set(records.filter((record): record is ResumeDefinition => record.record_type === "resume_definition" && record.definition_kind === "targeted").map((record) => record.metadata.revision_id));
  const variantTargetIds = new Set(records.filter((record) => record.record_type === "tailored_variant").map((record) => record.targeted_definition_revision_id));
  if ([...targetedRevisionIds].some((revisionId) => !variantTargetIds.has(revisionId))) fail("Targeted definition is missing its atomic tailored-variant record");

  const parsed = LineageGraphSchema.safeParse({
    graph_version: 1,
    nodes: records.map((record) => ({
      revision_id: record.metadata.revision_id,
      record_type: record.record_type,
      fact_state: record.record_type === "career_fact" ? record.state : null,
      sensitivity: record.sensitivity,
    })),
    edges,
  });
  if (!parsed.success) fail(parsed.error.issues.map((issue) => issue.message).join("; "));
  return parsed.data;
}

export function validateResumeLineageRecords(records: readonly LineageRecord[]): void {
  buildResumeLineageGraph(records);
}

export function inboundLineageEdges(graph: ResumeLineageGraph, revisionId: string): LineageEdge[] {
  return graph.edges.filter((edge) => edge.to_revision_id === revisionId);
}

export function outboundLineageEdges(graph: ResumeLineageGraph, revisionId: string): LineageEdge[] {
  return graph.edges.filter((edge) => edge.from_revision_id === revisionId);
}

export function changedStatementIds(left: readonly ResumeStatement[], right: readonly ResumeStatement[]): string[] {
  const leftById = new Map(left.map((statement) => [statement.statement_id, statement]));
  const rightById = new Map(right.map((statement) => [statement.statement_id, statement]));
  return unique([...leftById.keys(), ...rightById.keys()]).filter((statementId) => {
    const before = leftById.get(statementId);
    const after = rightById.get(statementId);
    return !before || !after || canonicalInputDigest(before) !== canonicalInputDigest(after);
  });
}

function validateStatementStructure(statements: readonly ResumeStatement[]): void {
  const statementIds = statements.map((statement) => statement.statement_id);
  if (new Set(statementIds).size !== statementIds.length) fail("Definition contains duplicate statement identities");
  if (statements.some((statement) => statement.kind === "presentation" && statement.supporting_confirmed_fact_revision_ids.length > 0)) {
    fail("Presentation statements cannot carry factual support links");
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function fail(message: string): never {
  throw new ResumeDomainError("validation_failed", message, 409);
}
