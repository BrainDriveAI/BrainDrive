import { AlertCircle, RefreshCw, Settings, X } from "lucide-react";

type ErrorMessageProps = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  onOpenSettings?: () => void;
};

export default function ErrorMessage({
  message,
  onRetry,
  onDismiss,
  onOpenSettings
}: ErrorMessageProps) {
  return (
    <div className="mx-auto w-full max-w-[780px] py-2">
      <div className="flex items-start gap-3 rounded-xl border border-bd-danger-border bg-bd-danger-bg px-4 py-3">
        <AlertCircle
          size={18}
          strokeWidth={1.5}
          className="mt-0.5 shrink-0 text-bd-danger"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-bd-text-primary">{message}</p>
          <div className="mt-2 flex gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 rounded-lg bg-bd-amber px-3 py-1.5 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover"
              >
                <Settings size={12} strokeWidth={1.5} />
                Open Settings
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1.5 rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
              >
                <RefreshCw size={12} strokeWidth={1.5} />
                Try Again
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-bd-text-muted transition-colors hover:text-bd-text-secondary"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={onDismiss}
            className="shrink-0 text-bd-text-muted transition-colors hover:text-bd-text-secondary"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
