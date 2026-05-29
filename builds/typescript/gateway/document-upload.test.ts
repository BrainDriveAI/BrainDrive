import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildUploadedDocumentIndexEntry,
  buildUploadedMarkdownDocument,
  convertUploadedDocumentToMarkdown,
  inferUploadedDocumentMetadata,
  inferUploadedDocumentMetadataDeterministic,
  sanitizeSuggestedMarkdownFileName,
  type UploadedDocumentInput,
} from "./document-upload.js";
import type { AdapterConfig, Preferences } from "../contracts.js";

const adapterConfig: AdapterConfig = {
  base_url: "https://openrouter.ai/api/v1",
  model: "vision-model",
  api_key_env: "TEST_API_KEY",
};

const brainDriveModelsAdapterConfig: AdapterConfig = {
  base_url: "https://my.braindrive.ai/credits/v1",
  model: "claude-haiku-4-5-20251001",
  api_key_env: "AI_GATEWAY_API_KEY",
  provider_id: "braindrive-models",
};

const preferences: Preferences = {
  default_model: "vision-model",
  approval_mode: "auto-approve",
};

function baseInput(overrides: Partial<UploadedDocumentInput>): UploadedDocumentInput {
  return {
    fileName: "statement.txt",
    mimeType: "text/plain",
    data: Buffer.from("hello"),
    projectId: "finance",
    projectName: "Finance",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("document upload conversion", () => {
  it("preserves markdown uploads without adding duplicate frontmatter", async () => {
    const converted = await convertUploadedDocumentToMarkdown(
      baseInput({
        fileName: "notes.md",
        mimeType: "text/markdown",
        data: Buffer.from("---\ntitle: Notes\n---\n\n# Notes\n"),
      }),
      "openai-compatible",
      adapterConfig,
      preferences
    );

    const document = buildUploadedMarkdownDocument(
      baseInput({
        fileName: "notes.md",
        mimeType: "text/markdown",
        data: Buffer.from(""),
      }),
      converted
    );

    expect(converted.conversion).toBe("direct_markdown_upload");
    expect(document).toBe("---\ntitle: Notes\n---\n\n# Notes\n");
  });

  it("converts CSV uploads to markdown tables with explicit provenance", async () => {
    const converted = await convertUploadedDocumentToMarkdown(
      baseInput({
        fileName: "transactions.csv",
        mimeType: "application/vnd.ms-excel",
        data: Buffer.from("Date,Description,Amount\n2026-05-12,\"Coffee, downtown\",-4.50\n"),
      }),
      "openai-compatible",
      adapterConfig,
      preferences
    );

    const document = buildUploadedMarkdownDocument(
      baseInput({
        fileName: "transactions.csv",
        mimeType: "application/vnd.ms-excel",
        data: Buffer.from(""),
      }),
      converted
    );

    expect(converted.conversion).toBe("direct_csv_upload");
    expect(converted.markdown).toContain("| Date | Description | Amount |");
    expect(converted.markdown).toContain("| 2026-05-12 | Coffee, downtown | -4.50 |");
    expect(document).toContain('source_filename: "transactions.csv"');
    expect(document).toContain('conversion: "direct_csv_upload"');
  });

  it("sends PDFs to OpenRouter file parsing instead of extracting images", async () => {
    const pdfLike = Buffer.from("%PDF-1.6\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "# Dummy Statement\n\n| Date | Amount |\n|---|---:|\n| 2026-05-12 | $1.00 |",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const converted = await convertUploadedDocumentToMarkdown(
      baseInput({
        fileName: "dummy_statement.pdf",
        mimeType: "application/pdf",
        data: pdfLike,
      }),
      "openai-compatible",
      adapterConfig,
      preferences
    );

    expect(converted.conversion).toBe("ai_pdf_to_markdown");
    expect(converted.markdown).toContain("# Dummy Statement");

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>;
    const request = JSON.parse(String(calls[0]?.[1].body));
    expect(request.messages[1].content[1]).toMatchObject({
      type: "file",
      file: {
        filename: "dummy_statement.pdf",
      },
    });
    expect(request.messages[1].content[1].file.file_data).toMatch(/^data:application\/pdf;base64,/);
    expect(request.plugins).toEqual([
      {
        id: "file-parser",
        pdf: {
          engine: "mistral-ocr",
        },
      },
    ]);
  });

  it("sends PDFs to BrainDrive Models as LiteLLM-compatible file inputs", async () => {
    const pdfLike = Buffer.from("%PDF-1.6\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "# BrainDrive Statement",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const converted = await convertUploadedDocumentToMarkdown(
      baseInput({
        fileName: "dummy_statement.pdf",
        mimeType: "application/pdf",
        data: pdfLike,
      }),
      "openai-compatible",
      brainDriveModelsAdapterConfig,
      preferences
    );

    expect(converted.conversion).toBe("ai_pdf_to_markdown");
    expect(converted.markdown).toContain("# BrainDrive Statement");

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>;
    const request = JSON.parse(String(calls[0]?.[1].body));
    expect(calls[0]?.[0]).toBe("https://my.braindrive.ai/credits/v1/chat/completions");
    expect(request.messages[1].content[1].type).toBe("file");
    expect(request.messages[1].content[1].file.file_data).toMatch(/^data:application\/pdf;base64,/);
    expect(request.plugins).toBeUndefined();
  });

  it("infers finance statement metadata deterministically for CSV uploads", async () => {
    const input = baseInput({
      fileName: "Capital One May 2026.csv",
      mimeType: "text/csv",
      data: Buffer.from("Date,Description,Amount\n2026-05-12,Coffee,-4.50\n"),
    });
    const converted = await convertUploadedDocumentToMarkdown(
      input,
      "openai-compatible",
      adapterConfig,
      preferences
    );

    const metadata = inferUploadedDocumentMetadataDeterministic(input, converted);

    expect(metadata).toMatchObject({
      documentType: "credit_card_statement",
      statementLike: true,
      institution: "Capital One",
      accountType: "credit_card",
      statementMonth: "2026-05",
      suggestedFileName: "2026-05-capital-one.md",
    });
    expect(metadata.tags).toEqual(expect.arrayContaining(["finance", "statement", "credit-card-statement"]));
  });

  it("keeps investment statements out of budget statement routing", async () => {
    const input = baseInput({
      fileName: "HarborlineInvestments_RothIRA_2026-04.csv",
      mimeType: "text/csv",
      data: Buffer.from("Date,Description,Amount\n2026-04-30,Ending market value,7799.83\n"),
    });
    const converted = await convertUploadedDocumentToMarkdown(
      input,
      "openai-compatible",
      adapterConfig,
      preferences
    );

    const metadata = inferUploadedDocumentMetadataDeterministic(input, converted);

    expect(metadata).toMatchObject({
      documentType: "investment_statement",
      statementLike: false,
      accountType: "investment",
      statementMonth: "2026-04",
      suggestedFileName: null,
    });
    expect(metadata.tags).toEqual(expect.arrayContaining(["finance", "investment-statement"]));
    expect(metadata.tags).not.toContain("statement");
  });

  it("normalizes LLM metadata into safe statement filenames", async () => {
    const input = baseInput({
      fileName: "upload.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.6\n%%EOF"),
    });
    const converted = {
      title: "Statement",
      conversion: "ai_pdf_to_markdown" as const,
      markdown: "# Statement\n\nCapital One\nStatement period: 2026-05-01 to 2026-05-31\n",
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  document_type: "credit_card_statement",
                  statement_like: true,
                  institution: "Capital One",
                  account_type: "credit_card",
                  statement_month: "2026-05",
                  statement_period_start: "2026-05-01",
                  statement_period_end: "2026-05-31",
                  suggested_file_name: "../../2026-05-Capital One.pdf",
                  summary: "Capital One credit card statement for May 2026.",
                  tags: ["Finance", "Statement", "Credit Card Statement"],
                  confidence: "high",
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await inferUploadedDocumentMetadata(
      input,
      converted,
      "openai-compatible",
      adapterConfig,
      preferences
    );

    expect(metadata).toMatchObject({
      documentType: "credit_card_statement",
      statementLike: true,
      institution: "Capital One",
      statementMonth: "2026-05",
      statementPeriodStart: "2026-05-01",
      statementPeriodEnd: "2026-05-31",
      suggestedFileName: "2026-05-capital-one.md",
      summary: "Capital One credit card statement for May 2026.",
      confidence: "high",
    });
    expect(metadata.tags).toEqual(["finance", "statement", "credit-card-statement"]);
  });

  it("adds statement metadata to uploaded markdown and index entries", () => {
    const input = baseInput({
      fileName: "Capital One May 2026.csv",
      mimeType: "text/csv",
    });
    const converted = {
      title: "Capital One May 2026",
      conversion: "direct_csv_upload" as const,
      markdown: "| Date | Description | Amount |\n|---|---|---:|\n| 2026-05-12 | Coffee | -4.50 |",
    };
    const metadata = inferUploadedDocumentMetadataDeterministic(input, converted);
    const document = buildUploadedMarkdownDocument(input, converted, {
      importedAt: "2026-05-14T16:00:00.000Z",
      metadata,
    });
    const entry = buildUploadedDocumentIndexEntry(
      input,
      converted,
      "budget/statements/2026-05-capital-one.md",
      "2026-05-14T16:00:00.000Z",
      metadata
    );

    expect(document).toContain('document_type: "credit_card_statement"');
    expect(document).toContain('statement_month: "2026-05"');
    expect(document).toContain("tags:\n  - \"statement\"");
    expect(entry.fileName).toBe("budget/statements/2026-05-capital-one.md");
    expect(entry.type).toBe("Credit card statement");
    expect(entry.readWhen).toContain("2026-05");
  });

  it("sanitizes suggested markdown filenames", () => {
    expect(sanitizeSuggestedMarkdownFileName("../../2026-05 Capital One.pdf", "fallback.pdf"))
      .toBe("2026-05-capital-one.md");
    expect(sanitizeSuggestedMarkdownFileName("", "Bank of America June 2026.csv"))
      .toBe("bank-of-america-june-2026.md");
  });
});
