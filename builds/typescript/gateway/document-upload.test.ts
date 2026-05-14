import { describe, expect, it, vi } from "vitest";

import {
  buildUploadedMarkdownDocument,
  convertUploadedDocumentToMarkdown,
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
});
