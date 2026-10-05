import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, proposalInput, testGrant } from "./test-helpers.js";

const [memoryRoot, operationId, value] = process.argv.slice(2);
if (!memoryRoot || !operationId || !value) {
  throw new Error("worker arguments are required");
}

const store = new ResumeDataStore(
  memoryRoot,
  undefined,
  { afterTransactionStaged: async () => new Promise((resolve) => setTimeout(resolve, 100)) },
  false,
);
await store.initialize(testGrant().owner_id);
const service = new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z"));
const result = await service.proposeFact(
  proposalInput(value),
  authority("career.facts.propose", operationId as ReturnType<typeof crypto.randomUUID>),
);
process.stdout.write(`${JSON.stringify({ operation_id: operationId, revision_id: result.fact.metadata.revision_id })}\n`);
