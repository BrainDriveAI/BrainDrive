# Statements — Source Folder

*Reference for the `statements/` folder. Holds all owner-uploaded financial statements. Apps filter for the statement types they need.*

## What This Folder Contains

All owner-uploaded financial statements live here — a single destination for the owner to manage. Apps read the types they need:

- **Budget app** reads **checking and credit-card statements** (spending data)
- *(Future apps will read their relevant types — e.g., a debt-payoff app reads loan statements; an investment app reads brokerage statements.)*

The folder-level rules below apply to all statements regardless of type (formats, naming, discovery, duplicate handling, read-only invariant). Workflow-specific reading discipline (locked ledgers, owner-requested item audits, treatment of new/unusual items) lives in the app workflow that needs it.

This is the **Sources** primitive — raw owner data the Apps consume. Statements are read-only; the agent never modifies them.

## File Conventions

- **Format:** PDFs, CSVs, converted text files, or whatever the owner uploads. Don't assume a single format.
- **Naming:** Statement-cycle filenames may use the starting month, ending month, account name, institution, or the converted-upload name from BrainDrive. Don't infer the statement's coverage period from the filename alone.
- **Period overlap:** A single statement file may cover transactions across two calendar months (e.g., a credit-card cycle running mid-March to mid-April). For period-based analysis, read every statement file whose period overlaps the requested date range — not just files whose filename mentions the target period.
- **Originals are read-only:** Never edit a statement file. If the owner provides a correction, capture it in the relevant app's rules file or as a clarification in the generated output; never modify the original statement.

## Source Discovery

Before saying a statement or transaction is missing:

- Inspect the Finance file list and `statements/`.
- Search likely converted filenames, statement periods, institution names, account names, and uploaded paths from the upload confirmation.
- Remember that statement-cycle filenames may use the starting month, ending month, account name, or converted upload name.
- For period-based reports, read statement files whose statement period overlaps the requested date range — don't rely only on filenames containing the target period.

## Duplicate and Overlap Check

Before using newly uploaded statements for any app work, check for likely duplicate or overlapping source files by:

- institution
- account
- statement period
- transaction dates
- obvious repeated transaction rows

If an upload appears to overlap existing evidence, ask the owner whether to replace, merge, or skip before counting transactions. Don't silently double-count overlapping periods.

## Workflow-Specific Reading Discipline

When a specific workflow needs additional reading discipline (locked evidence ledgers, owner-requested item audits, new/unusual item handling), that discipline lives in the workflow's procedure file. For monthly comparison, see `../budget/compare.md` § Reading Discipline.
