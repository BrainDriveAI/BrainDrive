import { RefreshCw, WifiOff } from "lucide-react";

type ConnectionBannerProps = {
  status: "disconnected" | "reconnecting";
  onRetry?: () => void;
};

export default function ConnectionBanner({
  status,
  onRetry
}: ConnectionBannerProps) {
  return (
    <div className="border-b border-bd-danger-border bg-bd-danger-bg px-4 py-2">
      <div className="mx-auto flex max-w-[780px] items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {status === "reconnecting" ? (
            <RefreshCw
              size={14}
              strokeWidth={1.5}
              className="animate-spin text-bd-amber"
            />
          ) : (
            <WifiOff size={14} strokeWidth={1.5} className="text-bd-danger" />
          )}
          <span className="text-sm text-bd-text-primary">
            {status === "reconnecting"
              ? "Reconnecting..."
              : "Connection lost — your data is safe"}
          </span>
        </div>
        {status === "disconnected" && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
          >
            <RefreshCw size={12} strokeWidth={1.5} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
