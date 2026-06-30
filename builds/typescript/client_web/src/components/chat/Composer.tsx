import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { ArrowUp, Square } from "lucide-react";

type ComposerProps = {
  onSend?: (message: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
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
  layout = "inline",
  onHeightChange
}: ComposerProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const wasStreamingRef = useRef(isStreaming);
  const trimmedMessage = message.trim();
  const hasContent = trimmedMessage.length > 0;

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

  function handleSend() {
    if (!hasContent) return;

    onSend?.(trimmedMessage);
    setMessage("");

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

  const containerClassName =
    layout === "mobile-fixed"
      ? "pointer-events-auto border-t border-bd-border bg-bd-bg-chat/96 px-4 pb-2 pt-3 shadow-[0_-12px_32px_rgba(1,2,8,0.55)] backdrop-blur-sm"
      : "z-20 shrink-0 border-t border-bd-border bg-bd-bg-chat/96 px-4 pb-2 pt-3 backdrop-blur-sm sm:px-6";

  return (
    <div
      ref={wrapperRef}
      className={containerClassName}
      style={{
        paddingBottom: "calc(var(--safe-area-bottom) + 0.5rem)",
        paddingLeft: "max(1rem, var(--safe-area-left))",
        paddingRight: "max(1rem, var(--safe-area-right))"
      }}
    >
      <div className="mx-auto w-full max-w-[780px]">
        <div className="flex items-end gap-2 rounded-[24px] border border-bd-border bg-bd-bg-tertiary p-2">
          <textarea
            ref={textareaRef}
            value={message}
            rows={1}
            onChange={(event) => setMessage(event.target.value)}
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
      <p className="px-2 pt-1.5 text-center text-[11px] text-bd-text-muted/60">
        BrainDrive can make mistakes. Verify important information.
      </p>
    </div>
  );
}
