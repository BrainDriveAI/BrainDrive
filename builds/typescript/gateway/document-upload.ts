import type { AdapterConfig, Preferences } from "../contracts.js";
import { resolveAdapterConfigForPreferences } from "../adapters/index.js";
import { auditLog } from "../logger.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";

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
  converted: UploadedDocumentMarkdown
): string {
  const body = converted.markdown.trim();
  if (body.length === 0) {
    throw new Error("AI conversion returned empty markdown.");
  }

  if (converted.conversion === "direct_markdown_upload" && body.startsWith("---\n")) {
    return `${body}\n`;
  }

  const frontmatter = [
    "---",
    `title: ${yamlString(converted.title)}`,
    `source_filename: ${yamlString(input.fileName)}`,
    `source_type: ${yamlString(input.mimeType || "application/octet-stream")}`,
    `imported_at: ${yamlString(new Date().toISOString())}`,
    `conversion: ${yamlString(converted.conversion)}`,
    ...(converted.pageCount ? [`page_count: ${converted.pageCount}`] : []),
    "---",
    "",
  ].join("\n");

  return `${frontmatter}${body}\n`;
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

    const response = await fetch(`${resolvedConfig.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    return readMarkdownResponse(response, resolvedConfig, "ai_pdf_to_markdown");
  }

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
