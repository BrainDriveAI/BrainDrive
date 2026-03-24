import {
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { ArrowUp, FileText, Plus, Square, X } from "lucide-react";

import {
  isAcceptedFile,
  formatFileSize,
  type AttachedFile
} from "@/utils/file-utils";

type ComposerProps = {
  onSend?: (message: string, attachment?: File) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  attachment?: AttachedFile | null;
  onAttach?: (file: AttachedFile) => void;
  onRemoveAttachment?: () => void;
  fileError?: string | null;
  onClearFileError?: () => void;
  layout?: "inline" | "mobile-fixed";
  onHeightChange?: (height: number) => void;
};

const MAX_TEXTAREA_HEIGHT = 120;

function resizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

export default function Composer({
  onSend,
  onStop,
  isStreaming = false,
  attachment,
  onAttach,
  onRemoveAttachment,
  fileError,
  onClearFileError,
  layout = "inline",
  onHeightChange
}: ComposerProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const wasStreamingRef = useRef(isStreaming);
  const trimmedMessage = message.trim();
  const hasContent = trimmedMessage.length > 0 || attachment != null;

  useEffect(() => {
    if (textareaRef.current) {
      resizeTextarea(textareaRef.current);
    }
  }, [message]);

  useEffect(() => {
    if (!onHeightChange || !wrapperRef.current) {
      return;
    }

    const reportHeightChange = onHeightChange;
    const element = wrapperRef.current;

    function reportHeight() {
      reportHeightChange(Math.ceil(element.getBoundingClientRect().height));
    }

    reportHeight();

    const observer = new ResizeObserver(reportHeight);
    observer.observe(element);

    return () => {
      observer.disconnect();
      reportHeightChange(0);
    };
  }, [layout, onHeightChange]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      textareaRef.current?.focus({ preventScroll: true });
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  function handleFileSelect(file: File) {
    onClearFileError?.();

    if (!isAcceptedFile(file)) {
      return;
    }

    onAttach?.({
      file,
      name: file.name,
      size: formatFileSize(file.size)
    });
  }

  function handleSend() {
    if (!hasContent) return;

    onSend?.(trimmedMessage, attachment?.file);
    setMessage("");
    onRemoveAttachment?.();

    if (textareaRef.current) {
      textareaRef.current.style.height = "0px";
    }

    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }

  function handleActionPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setMessage(event.target.value);
  }

  const containerClassName =
    layout === "mobile-fixed"
      ? "pointer-events-auto border-t border-bd-border bg-bd-bg-chat/96 px-4 pb-5 pt-3 shadow-[0_-12px_32px_rgba(1,2,8,0.55)] backdrop-blur-sm"
      : "z-20 shrink-0 border-t border-bd-border bg-bd-bg-chat/96 px-4 pb-5 pt-3 backdrop-blur-sm sm:px-6";

  return (
    <div
      ref={wrapperRef}
      className={containerClassName}
      style={{
        paddingBottom: "calc(var(--safe-area-bottom) + 1.25rem)",
        paddingLeft: "max(1rem, var(--safe-area-left))",
        paddingRight: "max(1rem, var(--safe-area-right))"
      }}
    >
      <div className="mx-auto w-full max-w-[780px]">
        {fileError && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-danger">
            <span>{fileError}</span>
            <button
              type="button"
              onClick={onClearFileError}
              className="ml-2 shrink-0 text-bd-danger transition-opacity hover:opacity-70"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {attachment && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-bd-border bg-bd-bg-tertiary px-3 py-2">
            <FileText size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
            <span className="min-w-0 flex-1 truncate text-sm text-bd-text-primary">
              {attachment.name}
            </span>
            <span className="shrink-0 text-xs text-bd-text-muted">
              {attachment.size}
            </span>
            <button
              type="button"
              aria-label="Remove attachment"
              onClick={onRemoveAttachment}
              className="shrink-0 text-bd-text-muted transition-colors hover:text-bd-text-secondary"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-[24px] border border-bd-border bg-bd-bg-tertiary p-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.vtt,text/plain,text/markdown,text/vtt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bd-bg-hover text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover"
          >
            <Plus size={18} strokeWidth={1.5} />
          </button>

          <textarea
            ref={textareaRef}
            value={message}
            rows={1}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Message your BrainDrive..."
            className="max-h-[120px] min-h-[36px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 py-2 text-base text-bd-text-primary outline-none placeholder:text-bd-text-muted md:text-[15px]"
          />

          {isStreaming ? (
            <button
              type="button"
              aria-label="Stop generating"
              onPointerDown={handleActionPointerDown}
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-bd-border bg-bd-bg-hover text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-tertiary"
            >
              <Square size={14} strokeWidth={1.5} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send message"
              disabled={!hasContent}
              onPointerDown={handleActionPointerDown}
              onClick={handleSend}
              className={[
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bd-amber text-white transition-all duration-200",
                !hasContent
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-bd-amber-hover"
              ].join(" ")}
            >
              <ArrowUp size={18} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
