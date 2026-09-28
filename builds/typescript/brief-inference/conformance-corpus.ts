import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import corpusDocument from "./fixtures/corpus.json" with { type: "json" };

export const BRIEF_MODEL_CONFORMANCE_CORPUS_DIGEST = canonicalInputDigest(corpusDocument);

export function briefConformanceFixtures(): readonly { id: string; source: string }[] {
  return corpusDocument.fixtures.map(({ id, source }) => ({ id, source }));
}
