type TypingIndicatorProps = {
  statusText?: string;
};

export default function TypingIndicator({
  statusText
}: TypingIndicatorProps) {
  return (
    <div className="flex items-center gap-3 px-1 py-3">
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 animate-[bounce_1.4s_ease-in-out_infinite] rounded-full bg-bd-text-muted" />
        <span className="h-2 w-2 animate-[bounce_1.4s_ease-in-out_0.2s_infinite] rounded-full bg-bd-text-muted" />
        <span className="h-2 w-2 animate-[bounce_1.4s_ease-in-out_0.4s_infinite] rounded-full bg-bd-text-muted" />
      </div>
      {statusText && (
        <span className="text-sm text-bd-text-muted">{statusText}</span>
      )}
    </div>
  );
}
