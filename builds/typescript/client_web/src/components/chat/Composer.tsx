import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { ArrowUp, Square } from "lucide-react";

import type { ChatSendOutcome } from "@/api/types";

type ComposerProps = {
  onSend?: (message: string) => void | ChatSendOutcome | Promise<ChatSendOutcome | void>;
  onStop?: () => void;
  isStreaming?: boolean;
  layout?: "inline" | "mobile-fixed";
  onHeightChange?: (height: number) => void;
  draftKey?: string | null;
};

const MAX_TEXTAREA_HEIGHT = 120;
const COMPOSER_DRAFT_CHANGE_EVENT = "braindrive:composer-draft-change";
const PENDING_SEND_SUFFIX = ":pending-send";

type DraftState = {
  key: string | null;
  message: string;
};

type PendingDraft = {
  token: string;
  message: string;
};

type ComposerDraftChangeEvent = CustomEvent<{
  key: string;
  value: string;
}>;

function resizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

function readStoredDraft(key: string | null): string {
  if (!key || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStoredDraft(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value.length > 0) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
    window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_CHANGE_EVENT, { detail: { key, value } }));
  } catch {
    // Draft text remains available in component state when browser storage is unavailable.
  }
}

export function restoreComposerDraft(key: string, value: string): void {
  if (!key || value.trim().length === 0) return;
  writeStoredDraft(key, value);
}

export function clearComposerDraft(key: string, expectedValue?: string): void {
  if (!key) return;
  if (expectedValue !== undefined && readStoredDraft(key) !== expectedValue) return;
  writeStoredDraft(key, "");
}

function pendingDraftKey(key: string): string {
  return `${key}${PENDING_SEND_SUFFIX}`;
}

function readPendingDraft(key: string | null): PendingDraft | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(pendingDraftKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingDraft>;
    return typeof parsed.token === "string" && parsed.token.length > 0 &&
      typeof parsed.message === "string" && parsed.message.length > 0
      ? { token: parsed.token, message: parsed.message }
      : null;
  } catch {
    return null;
  }
}

function writePendingDraft(key: string, draft: PendingDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pendingDraftKey(key), JSON.stringify(draft));
  } catch {
    // The visible composer remains the source of truth when storage is unavailable.
  }
}

function removePendingDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(pendingDraftKey(key));
  } catch {
    // Best-effort cleanup only.
  }
}

function newPendingToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readInitialDraft(key: string | null): { message: string; restored: boolean } {
  const storedDraft = readStoredDraft(key);
  if (storedDraft.length > 0) {
    return { message: storedDraft, restored: false };
  }

  const pending = readPendingDraft(key);
  return pending
    ? { message: pending.message, restored: true }
    : { message: "", restored: false };
}

export default function Composer({
  onSend,
  onStop,
  isStreaming = false,
  layout = "inline",
  onHeightChange,
  draftKey = null
}: ComposerProps) {
  const normalizedDraftKey = draftKey ?? null;
  const initialDraft = readInitialDraft(normalizedDraftKey);
  const [draftState, setDraftState] = useState<DraftState>(() => ({
    key: normalizedDraftKey,
    message: initialDraft.message,
  }));
  const [draftRestored, setDraftRestored] = useState(initialDraft.restored);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const wasStreamingRef = useRef(isStreaming);
  const sendLockRef = useRef(false);
  const pendingSendRef = useRef<PendingDraft | null>(null);
  const draftMessageRef = useRef(initialDraft.message);
  const message = draftState.message;
  const trimmedMessage = message.trim();
  const hasContent = trimmedMessage.length > 0;

  draftMessageRef.current = message;

  useEffect(() => {
    setDraftState((current) => {
      if (current.key === normalizedDraftKey) return current;
      const nextDraft = readInitialDraft(normalizedDraftKey);
      draftMessageRef.current = nextDraft.message;
      setDraftRestored(nextDraft.restored);
      return {
        key: normalizedDraftKey,
        message: nextDraft.message,
      };
    });
  }, [normalizedDraftKey]);

  useEffect(() => {
    if (draftState.key !== normalizedDraftKey || !normalizedDraftKey) return;
    writeStoredDraft(normalizedDraftKey, draftState.message);

    const pending = readPendingDraft(normalizedDraftKey);
    if (pending && draftState.message.length > 0 && draftState.message !== pending.message) {
      removePendingDraft(normalizedDraftKey);
      pendingSendRef.current = null;
    }
  }, [draftState, normalizedDraftKey]);

  useEffect(() => {
    if (!normalizedDraftKey || typeof window === "undefined") return;

    function handleDraftChange(event: Event) {
      const detail = (event as ComposerDraftChangeEvent).detail;
      if (!detail || detail.key !== normalizedDraftKey) return;
      setDraftState((current) => {
        if (current.key !== normalizedDraftKey || current.message === detail.value) return current;
        return { key: normalizedDraftKey, message: detail.value };
      });
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== normalizedDraftKey) return;
      const nextValue = event.newValue ?? "";
      setDraftState((current) => {
        if (current.key !== normalizedDraftKey || current.message === nextValue) return current;
        return { key: normalizedDraftKey, message: nextValue };
      });
    }

    window.addEventListener(COMPOSER_DRAFT_CHANGE_EVENT, handleDraftChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(COMPOSER_DRAFT_CHANGE_EVENT, handleDraftChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [normalizedDraftKey]);

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
      sendLockRef.current = false;
      textareaRef.current?.focus({ preventScroll: true });
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  function handleSend() {
    if (!hasContent || sendLockRef.current) return;

    sendLockRef.current = true;

    const pendingDraft = { token: newPendingToken(), message: trimmedMessage };
    pendingSendRef.current = pendingDraft;
    if (normalizedDraftKey) {
      writePendingDraft(normalizedDraftKey, pendingDraft);
    }

    let sendResult: void | ChatSendOutcome | Promise<ChatSendOutcome | void>;
    try {
      sendResult = onSend?.(trimmedMessage);
    } catch {
      sendResult = "failed";
    }
    setDraftState({ key: normalizedDraftKey, message: "" });
    setDraftRestored(false);
    if (normalizedDraftKey) {
      clearComposerDraft(normalizedDraftKey);
    }

    void Promise.resolve(sendResult).then((outcome) => {
      if (!normalizedDraftKey) return;
      const storedPending = readPendingDraft(normalizedDraftKey);
      if (!storedPending || storedPending.token !== pendingDraft.token) return;

      pendingSendRef.current = null;
      if (outcome === "session_expired" && draftMessageRef.current.trim().length === 0) {
        draftMessageRef.current = pendingDraft.message;
        setDraftState({ key: normalizedDraftKey, message: pendingDraft.message });
        setDraftRestored(true);
        restoreComposerDraft(normalizedDraftKey, pendingDraft.message);
      }
      removePendingDraft(normalizedDraftKey);
    }).catch(() => {
      if (normalizedDraftKey) {
        const storedPending = readPendingDraft(normalizedDraftKey);
        if (storedPending?.token === pendingDraft.token) {
          pendingSendRef.current = null;
          removePendingDraft(normalizedDraftKey);
        }
      }
    });

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
            onChange={(event) => {
              setDraftRestored(false);
              setDraftState({ key: normalizedDraftKey, message: event.target.value });
            }}
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
                "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-bd-amber px-3 text-sm font-medium text-white transition-all duration-200",
                !hasContent
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-bd-amber-hover"
              ].join(" ")}
            >
              <ArrowUp size={18} strokeWidth={1.5} />
              <span>Send</span>
            </button>
          )}
        </div>
        {draftRestored ? (
          <p role="status" aria-live="polite" className="px-2 pt-1.5 text-xs text-bd-text-secondary">
            Your unsent message was restored after session expiry. Review it before sending again.
          </p>
        ) : null}
      </div>
      <p className="px-2 pt-1.5 text-center text-[11px] text-bd-text-muted/60">
        BrainDrive can make mistakes. Verify important information.
      </p>
    </div>
  );
}
