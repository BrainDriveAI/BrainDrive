export const ACCEPTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".vtt",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf"
];

export const ACCEPTED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/vtt",
  "text/csv",
  "application/csv",
  "application/x-csv",
  "application/vnd.ms-excel",
  "text/comma-separated-values",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf"
];

export const ACCEPTED_FILE_INPUT = [
  ...ACCEPTED_EXTENSIONS,
  ...ACCEPTED_MIME_TYPES
].join(",");

const MODEL_CONVERTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".pdf"];

export type AttachedFile = {
  file: File;
  name: string;
  size: string;
};

export function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  const acceptedByExtension = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (acceptedByExtension) {
    return true;
  }

  if (mimeType === "application/vnd.ms-excel" && !name.endsWith(".csv")) {
    return false;
  }

  return (
    ACCEPTED_MIME_TYPES.includes(mimeType)
  );
}

export function requiresMarkdownConversion(file: File): boolean {
  const name = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("image/") ||
    MODEL_CONVERTED_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function rejectFileMessage(fileName: string): string {
  return `"${fileName}" is not supported. Upload .txt, .md, .markdown, .vtt, .csv, .png, .jpg, .jpeg, .webp, or .pdf files.`;
}
