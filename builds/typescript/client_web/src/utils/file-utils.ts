// V1 supports text files only. Image upload deferred to V1.1.
export const ACCEPTED_EXTENSIONS = [".txt", ".md", ".vtt"];

export type AttachedFile = {
  file: File;
  name: string;
  size: string;
};

export function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function rejectFileMessage(fileName: string): string {
  return `"${fileName}" is not supported. Upload .txt, .md, or .vtt files.`;
}
