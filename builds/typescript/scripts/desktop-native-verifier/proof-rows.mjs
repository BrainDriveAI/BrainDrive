import { normalizeRow, STATUS } from "./verification-contract.mjs";

// Desktop proof-row registry derived from App Lifecycle Evaluation Plan revision 12.
// Only the four contract statuses may leave the verifier.
const ROW_IDS = [
  "AC-1.1", "AC-1.2", "AC-1.3", "AC-1.4", "AC-1.5", "AC-1.6", "AC-1.7",
  "AC-2.1", "AC-2.2", "AC-2.3", "AC-2.4",
  "AC-3.1", "AC-3.2", "AC-3.3", "AC-3.4", "AC-3.5", "AC-3.6",
  "AC-4.1", "AC-4.2", "AC-4.3", "AC-5.1", "AC-5.2",
  "AC-6.1", "AC-6.2", "AC-6.3", "AC-6.4",
  "AC-8.1", "AC-8.2", "AC-8.3", "AC-8.4", "AC-8.5", "AC-8.6",
  "AC-9.1", "AC-9.2", "AC-9.3", "AC-9.4", "AC-9.5", "AC-9.6",
  "CF-1", "CF-2", "CF-3", "CF-4", "CF-5", "CF-6", "CF-7", "CF-8",
  "TB-1", "TB-2", "TB-3", "TB-4", "TB-5", "TB-6",
  "FR-1", "FR-2", "FR-3", "FR-4", "FR-5", "FR-6", "FR-7", "FR-8", "FR-9", "FR-10",
  "DC-1", "DC-2", "DC-3", "DC-4", "DC-5",
  "IF-1", "IF-2", "IF-3", "NG-1", "NG-2",
];

if (ROW_IDS.length !== 72) throw new Error(`Desktop proof-row registry must contain 72 rows, found ${ROW_IDS.length}.`);

export const DESKTOP_PROOF_ROW_COUNT = ROW_IDS.length;

export function createDesktopProofRows(rowChecks = {}) {
  return ROW_IDS.map((id) => {
    const check = rowChecks[id];
    if (check) return { id, ...normalizeRow(check) };
    return {
      id,
      status: STATUS.NOT_RUN,
      basis: "The native runner has not executed this row's required scenario and evidence contract yet.",
    };
  });
}
