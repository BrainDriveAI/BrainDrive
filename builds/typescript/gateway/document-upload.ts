import type { AdapterConfig, Preferences } from "../contracts.js";
import { resolveAdapterConfigForPreferences } from "../adapters/index.js";
import { auditLog } from "../logger.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import type { ProjectIndexEntry } from "../memory/folder-index.js";

export type UploadedDocumentInput = {
  fileName: string;
  mimeType: string;
  data: Buffer;
  projectId: string;
  projectName: string;
};

export type UploadedDocumentMarkdown = {
  title: string;
  markdown: string;
  conversion: "direct_markdown_upload" | "direct_text_upload" | "direct_csv_upload" | "ai_image_to_markdown" | "ai_pdf_to_markdown";
  pageCount?: number;
};

export type UploadedDocumentMetadata = {
  documentType: "bank_statement" | "credit_card_statement" | "investment_statement" | "budget_export" | "receipt" | "tax_document" | "paystub" | "other";
  statementLike: boolean;
  institution: string | null;
  accountType: "checking" | "savings" | "credit_card" | "bank_account" | "investment" | "unknown";
  statementMonth: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  suggestedFileName: string | null;
  summary: string;
  tags: string[];
  confidence: "low" | "medium" | "high";
};

export class DocumentConversionProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerPayload: unknown
  ) {
    super(message);
    this.name = "DocumentConversionProviderError";
  }
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: ChatCompletionContent;
    };
  }>;
  error?: {
    message?: string;
    code?: string | number;
    metadata?: {
      provider_name?: string;
      raw?: string;
    };
  };
};

type ChatCompletionContent = string | Array<{ type?: string; text?: string }> | null | undefined;

const MAX_VISION_IMAGES = 6;
const METADATA_EXCERPT_LIMIT = 12000;
const CONVERSION_RETRY_ATTEMPTS = 3;
const TRANSIENT_PROVIDER_STATUSES = new Set([
  408,
  409,
  425,
  429,
  500,
  502,
  503,
  504,
  520,
  521,
  522,
  523,
  524,
]);

export async function convertUploadedDocumentToMarkdown(
  input: UploadedDocumentInput,
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences
): Promise<UploadedDocumentMarkdown> {
  const extension = getExtension(input.fileName);
  const mimeType = input.mimeType.toLowerCase();
  const title = titleFromFileName(input.fileName);

  if (extension === ".md" || extension === ".markdown" || mimeType === "text/markdown") {
    return {
      title,
      markdown: input.data.toString("utf8"),
      conversion: "direct_markdown_upload",
    };
  }

  if (isCsvUpload(extension, mimeType)) {
    return {
      title,
      markdown: convertCsvToMarkdown(input.data),
      conversion: "direct_csv_upload",
    };
  }

  if (extension === ".txt" || mimeType.startsWith("text/")) {
    return {
      title,
      markdown: input.data.toString("utf8"),
      conversion: "direct_text_upload",
    };
  }

  if (isImageUpload(extension, mimeType)) {
    const markdown = await convertImagesWithVision(
      [
        {
          mimeType: normalizeImageMimeType(extension, mimeType),
          data: input.data,
        },
      ],
      input,
      adapterName,
      adapterConfig,
      preferences,
      "ai_image_to_markdown"
    );

    return {
      title,
      markdown,
      conversion: "ai_image_to_markdown",
    };
  }

  if (extension === ".pdf" || mimeType === "application/pdf") {
    const markdown = await convertPdfToMarkdown(
      input,
      adapterName,
      adapterConfig,
      preferences
    );

    return {
      title,
      markdown,
      conversion: "ai_pdf_to_markdown",
    };
  }

  throw new Error("This file type is not supported yet. Upload markdown, text, CSV, images, or PDFs.");
}

export function buildUploadedMarkdownDocument(
  input: UploadedDocumentInput,
  converted: UploadedDocumentMarkdown,
  options: { importedAt?: string; metadata?: UploadedDocumentMetadata | null } = {}
): string {
  const body = converted.markdown.trim();
  if (body.length === 0) {
    throw new Error("AI conversion returned empty markdown.");
  }

  if (converted.conversion === "direct_markdown_upload" && body.startsWith("---\n")) {
    return `${body}\n`;
  }

  const importedAt = options.importedAt ?? new Date().toISOString();
  const summary = options.metadata?.summary ?? buildUploadedDocumentSummary(input, converted);
  const frontmatter = [
    "---",
    `title: ${yamlString(converted.title)}`,
    `source_filename: ${yamlString(input.fileName)}`,
    `source_type: ${yamlString(input.mimeType || "application/octet-stream")}`,
    `imported_at: ${yamlString(importedAt)}`,
    `conversion: ${yamlString(converted.conversion)}`,
    ...(options.metadata ? [
      `document_type: ${yamlString(options.metadata.documentType)}`,
      `statement_like: ${options.metadata.statementLike ? "true" : "false"}`,
      ...(options.metadata.institution ? [`institution: ${yamlString(options.metadata.institution)}`] : []),
      ...(options.metadata.accountType !== "unknown" ? [`account_type: ${yamlString(options.metadata.accountType)}`] : []),
      ...(options.metadata.statementMonth ? [`statement_month: ${yamlString(options.metadata.statementMonth)}`] : []),
      ...(options.metadata.statementPeriodStart ? [`statement_period_start: ${yamlString(options.metadata.statementPeriodStart)}`] : []),
      ...(options.metadata.statementPeriodEnd ? [`statement_period_end: ${yamlString(options.metadata.statementPeriodEnd)}`] : []),
      ...(options.metadata.tags.length > 0 ? ["tags:", ...options.metadata.tags.map((tag) => `  - ${yamlString(tag)}`)] : []),
    ] : []),
    `summary: ${yamlString(summary)}`,
    ...(converted.pageCount ? [`page_count: ${converted.pageCount}`] : []),
    "---",
    "",
  ].join("\n");

  return [
    frontmatter,
    `# ${converted.title}`,
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Source Content",
    "",
    body,
    "",
  ].join("\n");
}

export function buildUploadedDocumentIndexEntry(
  input: UploadedDocumentInput,
  converted: UploadedDocumentMarkdown,
  fileName: string,
  importedAt: string,
  metadata?: UploadedDocumentMetadata | null
): ProjectIndexEntry {
  return {
    fileName,
    type: metadata ? readableDocumentType(metadata, input, converted) : uploadedDocumentType(input, converted),
    summary: metadata?.summary ?? buildUploadedDocumentSummary(input, converted),
    readWhen: buildUploadedDocumentReadWhen(input, converted, fileName, metadata),
    importedAt,
  };
}

export async function inferUploadedDocumentMetadata(
  input: UploadedDocumentInput,
  converted: UploadedDocumentMarkdown,
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences
): Promise<UploadedDocumentMetadata> {
  const fallback = inferUploadedDocumentMetadataDeterministic(input, converted);
  if (input.projectId !== "finance") {
    return fallback;
  }

  try {
    const resolvedConfig = resolveUploadAdapterConfig(adapterConfig, preferences);
    const credential = await resolveProviderCredentialForStartup(adapterName, resolvedConfig, preferences);
    const apiKey = credential?.apiKey ?? process.env[resolvedConfig.api_key_env] ?? "";
    const response = await fetch(`${resolvedConfig.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: resolvedConfig.model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You extract finance document metadata for BrainDrive uploads. Return only compact JSON.",
          },
          {
            role: "user",
            content: buildMetadataPrompt(input, converted),
          },
        ],
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      auditLog("document_upload.metadata_provider_error", {
        status: response.status,
        model: resolvedConfig.model,
        base_url: redactUrl(resolvedConfig.base_url),
      });
      return fallback;
    }

    const payload = parseJsonObject(responseText) as ChatCompletionResponse;
    const jsonText = extractJsonObject(normalizeAssistantMarkdown(payload.choices?.[0]?.message?.content));
    if (!jsonText) {
      return fallback;
    }

    return normalizeUploadedDocumentMetadata(JSON.parse(jsonText), fallback);
  } catch (error) {
    auditLog("document_upload.metadata_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export function inferUploadedDocumentMetadataDeterministic(
  input: UploadedDocumentInput,
  converted: UploadedDocumentMarkdown
): UploadedDocumentMetadata {
  const text = `${input.fileName}\n${converted.title}\n${converted.markdown}`.toLowerCase();
  const hasTransactions = /\b(date|posted|description|merchant|amount|debit|credit|balance)\b/.test(text);
  const isCreditCard = /\b(credit card|capital one|visa|mastercard|payment due|minimum payment)\b/.test(text);
  const isBank = /\b(bank|checking|savings|deposit|withdrawal|beginning balance|ending balance)\b/.test(text);
  const isInvestment = /\b(investment|brokerage|roth|ira|retirement|portfolio|holding|holdings|position|positions|market value|asset allocation|fund|etf|dividend|harborline|vanguard|fidelity|schwab|e\*?trade)\b/.test(text);
  const isBudget = /\b(budget|category|monthly limit|planned)\b/.test(text) && !isBank && !isCreditCard;
  const documentType = isCreditCard
    ? "credit_card_statement"
    : isInvestment
      ? "investment_statement"
      : isBank || hasTransactions
        ? "bank_statement"
        : isBudget
          ? "budget_export"
          : "other";
  const statementMonth = inferStatementMonth(input.fileName, converted.markdown);
  const institution = inferInstitution(input.fileName, converted.markdown);
  const statementLike = documentType === "bank_statement" || documentType === "credit_card_statement";

  return {
    documentType,
    statementLike,
    institution,
    accountType: isCreditCard ? "credit_card" : isInvestment ? "investment" : isBank || hasTransactions ? "bank_account" : "unknown",
    statementMonth,
    statementPeriodStart: null,
    statementPeriodEnd: null,
    suggestedFileName: statementLike ? suggestedStatementFileName(statementMonth, institution, input.fileName) : null,
    summary: `${converted.title} uploaded from ${input.fileName} and saved as markdown.`,
    tags: [
      ...(statementLike ? ["statement"] : []),
      ...(documentType !== "other" ? [documentType.replace(/_/g, "-")] : []),
      ...(input.projectId === "finance" ? ["finance"] : []),
    ],
    confidence: statementLike && statementMonth ? "medium" : "low",
  };
}

export function sanitizeSuggestedMarkdownFileName(value: string | null | undefined, fallback: string): string {
  const source = value && value.trim().length > 0 ? value : fallback;
  const withoutPath = source.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? fallback;
  const withoutExtension = withoutPath.replace(/\.[^.]+$/, "");
  const slug = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug.length > 0 ? slug : "uploaded-document"}.md`;
}

function buildMetadataPrompt(input: UploadedDocumentInput, converted: UploadedDocumentMarkdown): string {
  return [
    "Classify this uploaded Finance project document and suggest a safe markdown filename.",
    "Return JSON only. Do not include markdown fences.",
    "",
    "Expected JSON shape:",
    JSON.stringify({
      document_type: "bank_statement|credit_card_statement|investment_statement|budget_export|receipt|tax_document|paystub|other",
      statement_like: true,
      institution: "Capital One or null",
      account_type: "checking|savings|credit_card|bank_account|investment|unknown",
      statement_month: "YYYY-MM or null",
      statement_period_start: "YYYY-MM-DD or null",
      statement_period_end: "YYYY-MM-DD or null",
      suggested_file_name: "YYYY-MM-institution.md or null",
      summary: "one sentence",
      tags: ["finance", "statement"],
      confidence: "low|medium|high",
    }),
    "",
    "Filename rules:",
    "- For bank or credit card statements, prefer YYYY-MM-institution.md.",
    "- Investment, brokerage, IRA, retirement, portfolio, holdings, or market-value statements are investment_statement and statement_like false unless they are clearly checking or credit card transaction statements.",
    "- Use the transaction/statement period, not today's date.",
    "- If the period is unclear, use null for statement_month and suggested_file_name.",
    "- Suggested filename must not include directories.",
    "",
    `Source filename: ${input.fileName}`,
    `Converted title: ${converted.title}`,
    `Conversion: ${converted.conversion}`,
    "",
    "Converted markdown excerpt:",
    converted.markdown.slice(0, METADATA_EXCERPT_LIMIT),
  ].join("\n");
}

function normalizeUploadedDocumentMetadata(value: unknown, fallback: UploadedDocumentMetadata): UploadedDocumentMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const documentType = normalizeDocumentType(record.document_type, fallback.documentType);
  const statementLike = typeof record.statement_like === "boolean"
    ? record.statement_like
    : documentType === "bank_statement" || documentType === "credit_card_statement";
  const institution = normalizeNullableString(record.institution) ?? fallback.institution;
  const statementMonth = normalizeMonth(record.statement_month) ?? fallback.statementMonth;
  const suggestedFileName = sanitizeSuggestedMarkdownFileName(
    normalizeNullableString(record.suggested_file_name) ??
      (statementLike ? suggestedStatementFileName(statementMonth, institution, fallback.suggestedFileName ?? "") : null),
    fallback.suggestedFileName ?? "uploaded-document.md"
  );

  return {
    documentType,
    statementLike,
    institution,
    accountType: normalizeAccountType(record.account_type, fallback.accountType),
    statementMonth,
    statementPeriodStart: normalizeDate(record.statement_period_start) ?? fallback.statementPeriodStart,
    statementPeriodEnd: normalizeDate(record.statement_period_end) ?? fallback.statementPeriodEnd,
    suggestedFileName: statementLike ? suggestedFileName : null,
    summary: normalizeNullableString(record.summary) ?? fallback.summary,
    tags: normalizeTags(record.tags, fallback.tags),
    confidence: normalizeConfidence(record.confidence, fallback.confidence),
  };
}

function normalizeDocumentType(value: unknown, fallback: UploadedDocumentMetadata["documentType"]): UploadedDocumentMetadata["documentType"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "bank_statement":
    case "credit_card_statement":
    case "investment_statement":
    case "budget_export":
    case "receipt":
    case "tax_document":
    case "paystub":
    case "other":
      return normalized;
    default:
      return fallback;
  }
}

function normalizeAccountType(value: unknown, fallback: UploadedDocumentMetadata["accountType"]): UploadedDocumentMetadata["accountType"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "checking":
    case "savings":
    case "credit_card":
    case "bank_account":
    case "investment":
    case "unknown":
      return normalized;
    default:
      return fallback;
  }
}

function normalizeConfidence(value: unknown, fallback: UploadedDocumentMetadata["confidence"]): UploadedDocumentMetadata["confidence"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
      return normalized;
    default:
      return fallback;
  }
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "null") {
    return null;
  }
  return normalized;
}

function normalizeMonth(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  return normalized && /^\d{4}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeDate(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeTags(value: unknown, fallback: string[]): string[] {
  const rawTags = Array.isArray(value) ? value : fallback;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of rawTags) {
    if (typeof tag !== "string") {
      continue;
    }
    const normalized = tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags.slice(0, 8);
}

function inferStatementMonth(fileName: string, markdown: string): string | null {
  const haystack = `${fileName}\n${markdown}`;
  const isoMonth = /\b(20\d{2})[-_/](0[1-9]|1[0-2])\b/.exec(haystack);
  if (isoMonth) {
    return `${isoMonth[1]}-${isoMonth[2]}`;
  }

  const monthName = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b[^\d]{0,20}\b(20\d{2})\b/i.exec(haystack);
  if (monthName) {
    const month = monthNumber(monthName[1] ?? "");
    return month ? `${monthName[2]}-${month}` : null;
  }

  const isoDate = /\b(20\d{2})-(0[1-9]|1[0-2])-\d{2}\b/.exec(haystack);
  return isoDate ? `${isoDate[1]}-${isoDate[2]}` : null;
}

function monthNumber(value: string): string | null {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const index = months.indexOf(value.toLowerCase());
  return index === -1 ? null : String(index + 1).padStart(2, "0");
}

function inferInstitution(fileName: string, markdown: string): string | null {
  const haystack = `${fileName}\n${markdown}`.toLowerCase();
  const known = [
    "capital one",
    "bank of america",
    "chase",
    "wells fargo",
    "citi",
    "citibank",
    "american express",
    "discover",
  ];
  const match = known.find((candidate) => haystack.includes(candidate));
  if (match) {
    return titleCase(match);
  }

  const baseName = fileName.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const cleaned = baseName.replace(/\b(20\d{2}|statement|transactions|export|csv|pdf|may|june|july|august|september|october|november|december|january|february|march|april)\b/gi, " ");
  const words = cleaned.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? titleCase(words) : null;
}

function suggestedStatementFileName(statementMonth: string | null, institution: string | null, fallback: string): string | null {
  if (!statementMonth || !institution) {
    return null;
  }
  return sanitizeSuggestedMarkdownFileName(`${statementMonth}-${institution}.md`, fallback);
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function buildUploadedDocumentSummary(input: UploadedDocumentInput, converted: UploadedDocumentMarkdown): string {
  return `${converted.title} uploaded from ${input.fileName} and saved as markdown.`;
}

function buildUploadedDocumentReadWhen(
  input: UploadedDocumentInput,
  converted: UploadedDocumentMarkdown,
  fileName: string,
  metadata?: UploadedDocumentMetadata | null
): string {
  if (metadata?.statementLike) {
    return `User asks about this ${readableDocumentType(metadata, input, converted).toLowerCase()}, ${metadata.institution ?? converted.title}, ${metadata.statementMonth ?? "this statement period"}, budget progress, spending, transactions, transfers, income, refunds, or ${fileName}.`;
  }
  return `User asks about ${converted.title}, ${input.fileName}, ${fileName}, or information likely contained in this document.`;
}

function readableDocumentType(
  metadata: UploadedDocumentMetadata,
  input: UploadedDocumentInput,
  converted: UploadedDocumentMarkdown
): string {
  switch (metadata.documentType) {
    case "bank_statement":
      return "Bank statement";
    case "credit_card_statement":
      return "Credit card statement";
    case "investment_statement":
      return "Investment statement";
    case "budget_export":
      return "Budget export";
    case "receipt":
      return "Receipt";
    case "tax_document":
      return "Tax document";
    case "paystub":
      return "Paystub";
    case "other":
      return uploadedDocumentType(input, converted);
  }
}

function uploadedDocumentType(input: UploadedDocumentInput, converted: UploadedDocumentMarkdown): string {
  const mimeType = input.mimeType || "application/octet-stream";
  switch (converted.conversion) {
    case "direct_csv_upload":
      return "CSV document";
    case "direct_markdown_upload":
      return "Markdown document";
    case "direct_text_upload":
      return "Text document";
    case "ai_image_to_markdown":
      return `Image document (${mimeType})`;
    case "ai_pdf_to_markdown":
      return "PDF document";
  }
}

function extractPdfJpegImages(data: Buffer): Array<{ mimeType: string; data: Buffer }> {
  const images: Array<{ mimeType: string; data: Buffer }> = [];
  const startMarker = Buffer.from([0xff, 0xd8]);
  const endMarker = Buffer.from([0xff, 0xd9]);
  let offset = 0;

  while (offset < data.length) {
    const start = data.indexOf(startMarker, offset);
    if (start === -1) {
      break;
    }

    const end = data.indexOf(endMarker, start + startMarker.length);
    if (end === -1) {
      break;
    }

    const image = data.subarray(start, end + endMarker.length);
    if (image.length >= 1024) {
      images.push({
        mimeType: "image/jpeg",
        data: Buffer.from(image),
      });
    }

    offset = end + endMarker.length;
  }

  return images;
}

function convertCsvToMarkdown(data: Buffer): string {
  const rows = parseCsvRows(data.toString("utf8"));
  if (rows.length === 0) {
    return "_No CSV rows found._";
  }

  const width = Math.max(...rows.map((row) => row.length), 1);
  const headerRow = rows[0] ?? [];
  const headers = Array.from({ length: width }, (_, index) => {
    const header = headerRow[index]?.trim() ?? "";
    return header.length > 0 ? header : `Column ${index + 1}`;
  });
  const bodyRows = rows.slice(1).map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? "")
  );

  return [
    markdownTableRow(headers),
    markdownTableRow(headers.map(() => "---")),
    ...bodyRows.map((row) => markdownTableRow(row)),
  ].join("\n");
}

function parseCsvRows(value: string): string[][] {
  const text = value.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (inQuotes) {
      if (character === "\"" && nextCharacter === "\"") {
        cell += "\"";
        index += 1;
      } else if (character === "\"") {
        inQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === "\"" && cell.length === 0) {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (character === "\n" || character === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";

      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      continue;
    }

    cell += character;
  }

  if (cell.length > 0 || row.length > 0 || text.endsWith(",")) {
    row.push(cell);
    rows.push(row);
  }

  while (rows.length > 0 && rows[rows.length - 1]!.every((entry) => entry.trim().length === 0)) {
    rows.pop();
  }

  return rows;
}

function markdownTableRow(values: string[]): string {
  return `| ${values.map(markdownTableCell).join(" | ")} |`;
}

function markdownTableCell(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

async function convertPdfToMarkdown(
  input: UploadedDocumentInput,
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences
): Promise<string> {
  const resolvedConfig = resolveUploadAdapterConfig(adapterConfig, preferences);
  const credential = await resolveProviderCredentialForStartup(adapterName, resolvedConfig, preferences);
  const apiKey = credential?.apiKey ?? process.env[resolvedConfig.api_key_env] ?? "";
  const prompt = buildConversionPrompt(input);

  if (supportsPdfFileInput(resolvedConfig)) {
    const requestBody: Record<string, unknown> = {
      model: resolvedConfig.model,
      stream: false,
      messages: [
        {
          role: "system",
          content: "You convert uploaded user documents to accurate markdown. Return only markdown.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              type: "file",
              file: {
                filename: input.fileName,
                file_data: `data:application/pdf;base64,${input.data.toString("base64")}`,
              },
            },
          ],
        },
      ],
    };

    if (isOpenRouterBaseUrl(resolvedConfig.base_url)) {
      requestBody.plugins = [
        {
          id: "file-parser",
          pdf: {
            engine: "mistral-ocr",
          },
        },
      ];
    }

    try {
      return await withConversionRetry("ai_pdf_to_markdown", async () => {
        const response = await fetch(`${resolvedConfig.base_url}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(requestBody),
        });

        return readMarkdownResponse(response, resolvedConfig, "ai_pdf_to_markdown");
      });
    } catch (error) {
      if (!isEmptyMarkdownConversionError(error)) {
        throw error;
      }

      auditLog("document_upload.pdf_parser_empty_result", {
        model: resolvedConfig.model,
        base_url: redactUrl(resolvedConfig.base_url),
      });
    }
  }

  return convertPdfImagesToMarkdown(
    input,
    adapterName,
    adapterConfig,
    preferences
  );
}

async function convertPdfImagesToMarkdown(
  input: UploadedDocumentInput,
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences
): Promise<string> {
  const images = extractPdfJpegImages(input.data)
    .filter((image) => isValidJpeg(image.data))
    .sort((left, right) => right.data.length - left.data.length)
    .slice(0, MAX_VISION_IMAGES);

  if (images.length === 0) {
    throw new Error("This PDF requires OpenRouter PDF parsing or a PDF with extractable page images.");
  }

  return convertImagesWithVision(
    images,
    input,
    adapterName,
    adapterConfig,
    preferences,
    "ai_pdf_to_markdown"
  );
}

async function convertImagesWithVision(
  images: Array<{ mimeType: string; data: Buffer }>,
  input: UploadedDocumentInput,
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences,
  conversion: "ai_image_to_markdown" | "ai_pdf_to_markdown"
): Promise<string> {
  const resolvedConfig = resolveUploadAdapterConfig(adapterConfig, preferences);
  const credential = await resolveProviderCredentialForStartup(adapterName, resolvedConfig, preferences);
  const apiKey = credential?.apiKey ?? process.env[resolvedConfig.api_key_env] ?? "";
  const prompt = buildConversionPrompt(input);

  return withConversionRetry(conversion, async () => {
    const response = await fetch(`${resolvedConfig.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: resolvedConfig.model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You convert uploaded user documents to accurate markdown. Return only markdown.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              ...images.map((image) => ({
                type: "image_url",
                image_url: {
                  url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
                },
              })),
            ],
          },
        ],
      }),
    });

    return readMarkdownResponse(response, resolvedConfig, conversion);
  });
}

function buildConversionPrompt(input: UploadedDocumentInput): string {
  return [
    "Convert this uploaded document into a clean markdown document.",
    "Preserve visible text, headings, lists, tables, labels, and meaningful layout.",
    "If text is unreadable, mark it as [unclear].",
    "Do not add facts that are not visible in the uploaded document.",
    "Return only markdown.",
    "",
    `Source filename: ${input.fileName}`,
    `Destination project folder: ${input.projectName}`,
  ].join("\n");
}

async function readMarkdownResponse(
  response: Response,
  resolvedConfig: AdapterConfig,
  conversion: "ai_image_to_markdown" | "ai_pdf_to_markdown"
): Promise<string> {
  const responseText = await response.text();
  const payload = parseJsonObject(responseText) as ChatCompletionResponse;
  if (!response.ok) {
    const providerDetail = providerErrorDetail(payload, responseText);
    const message =
      providerDetail ??
      (responseText.trim() || `Document conversion failed with status ${response.status}`);
    auditLog("document_upload.provider_error", {
      status: response.status,
      model: resolvedConfig.model,
      base_url: redactUrl(resolvedConfig.base_url),
      provider_message: message,
      provider_code: payload.error?.code,
      provider_name: payload.error?.metadata?.provider_name,
    });
    throw new DocumentConversionProviderError(message, response.status, payload);
  }

  const content = payload.choices?.[0]?.message?.content;
  const markdown = normalizeAssistantMarkdown(content).trim();
  if (markdown.length === 0) {
    throw new Error(`${conversion} returned empty markdown.`);
  }

  return markdown;
}

async function withConversionRetry(
  conversion: "ai_image_to_markdown" | "ai_pdf_to_markdown",
  operation: () => Promise<string>
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CONVERSION_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= CONVERSION_RETRY_ATTEMPTS || !isRetryableConversionError(error)) {
        throw error;
      }

      const delayMs = conversionRetryDelayMs(attempt);
      auditLog("document_upload.conversion_retry", {
        conversion,
        attempt,
        next_attempt: attempt + 1,
        delay_ms: delayMs,
        status: error instanceof DocumentConversionProviderError ? error.status : undefined,
        error_name: error instanceof Error ? error.name : typeof error,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function isRetryableConversionError(error: unknown): boolean {
  if (error instanceof DocumentConversionProviderError) {
    return TRANSIENT_PROVIDER_STATUSES.has(error.status);
  }

  if (isAbortError(error) || isEmptyMarkdownConversionError(error)) {
    return false;
  }

  return error instanceof Error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isEmptyMarkdownConversionError(error: unknown): boolean {
  return error instanceof Error && /returned empty markdown/i.test(error.message);
}

function conversionRetryDelayMs(attempt: number): number {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return 0;
  }

  const baseDelay = 2000 * (3 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return baseDelay + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOpenRouterBaseUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === "openrouter.ai";
  } catch {
    return false;
  }
}

function supportsPdfFileInput(config: AdapterConfig): boolean {
  if (isOpenRouterBaseUrl(config.base_url)) {
    return true;
  }

  const providerId = config.provider_id?.toLowerCase();
  if (providerId === "braindrive-models" || providerId === "anthropic") {
    return true;
  }

  const model = config.model.toLowerCase();
  return model.startsWith("anthropic/claude-") || model.startsWith("claude-");
}

function isValidJpeg(data: Buffer): boolean {
  if (data.length < 12 || data[0] !== 0xff || data[1] !== 0xd8) {
    return false;
  }

  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = data[offset + 1];
    if (marker === 0xd9) {
      return true;
    }

    if (marker === 0xda) {
      return data.indexOf(Buffer.from([0xff, 0xd9]), offset + 2) !== -1;
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }

    const length = data.readUInt16BE(offset + 2);
    if (length < 2) {
      return false;
    }

    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = data.readUInt16BE(offset + 5);
      const width = data.readUInt16BE(offset + 7);
      if (width <= 0 || height <= 0) {
        return false;
      }
    }

    offset += 2 + length;
  }

  return false;
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function extractJsonObject(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return trimmed.slice(start, end + 1);
}

function providerErrorDetail(payload: ChatCompletionResponse, responseText: string): string | undefined {
  const raw = payload.error?.metadata?.raw?.trim();
  const message = payload.error?.message?.trim();

  if (raw && message && raw !== message) {
    return `${message}: ${raw}`;
  }

  return raw || message || responseText.trim() || undefined;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unknown";
  }
}

function resolveUploadAdapterConfig(adapterConfig: AdapterConfig, preferences: Preferences): AdapterConfig {
  const selectedConfig = resolveAdapterConfigForPreferences(adapterConfig, preferences);
  const activeProfile =
    preferences.active_provider_profile?.trim() ||
    adapterConfig.default_provider_profile?.trim() ||
    "";
  const providerModel = activeProfile
    ? preferences.provider_default_models?.[activeProfile]?.trim()
    : undefined;
  const legacyBootstrapModel = "llama3.1";
  const shouldUseProviderModel =
    Boolean(providerModel) &&
    !(providerModel === legacyBootstrapModel && selectedConfig.model !== legacyBootstrapModel);

  return {
    ...selectedConfig,
    ...(shouldUseProviderModel && providerModel ? { model: providerModel } : {}),
  };
}

function normalizeAssistantMarkdown(content: ChatCompletionContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }

  return "";
}

function isImageUpload(extension: string, mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    extension === ".png" ||
    extension === ".jpg" ||
    extension === ".jpeg" ||
    extension === ".webp"
  );
}

function isCsvUpload(extension: string, mimeType: string): boolean {
  if (mimeType === "application/vnd.ms-excel") {
    return extension === ".csv";
  }

  return (
    extension === ".csv" ||
    mimeType === "text/csv" ||
    mimeType === "application/csv" ||
    mimeType === "application/x-csv" ||
    mimeType === "text/comma-separated-values"
  );
}

function normalizeImageMimeType(extension: string, mimeType: string): string {
  if (mimeType.startsWith("image/")) {
    return mimeType;
  }

  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index === -1) {
    return "";
  }
  return fileName.slice(index).toLowerCase();
}

function titleFromFileName(fileName: string): string {
  const baseName = fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? "Uploaded Document";
  const words = baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words.length > 0
    ? words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : "Uploaded Document";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
