import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceCandidateIdentity } from './lib/evidence-identity.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--source-test-revision');
  if (index !== -1 && !process.argv[index + 1]) throw new Error('--source-test-revision requires a Git revision');
  const requested = index === -1 ? process.env.SOURCE_TEST_REVISION || 'HEAD' : process.argv[index + 1];
  const result = await sourceCandidateIdentity(process.cwd(), requested);
  process.stdout.write(`SOURCE_TEST_REVISION=${result.sourceTestRevision}\nSOURCE_CANDIDATE_PROOF=${result.sourceCandidateProof}\n`);
}

export { sourceCandidateIdentity } from './lib/evidence-identity.mjs';
