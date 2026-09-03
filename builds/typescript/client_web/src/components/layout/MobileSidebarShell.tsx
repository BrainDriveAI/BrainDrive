import { forwardRef, type ReactNode } from "react";
import { Menu } from "lucide-react";

type MobileSidebarHeaderProps = {
  openLabel: string;
  onOpen: () => void;
  leading?: ReactNode;
  eyebrow?: string;
  title?: string;
};

export const MobileSidebarHeader = forwardRef<HTMLDivElement, MobileSidebarHeaderProps>(
  function MobileSidebarHeader({ openLabel, onOpen, leading, eyebrow, title }, ref) {
    const hasTitle = Boolean(eyebrow || title);

    return (
      <div
        ref={ref}
        className="pointer-events-auto flex items-center gap-3 border-b border-bd-border bg-bd-bg-primary/95 px-4 py-3 backdrop-blur-sm"
        style={{
          paddingTop: "max(0.75rem, var(--safe-area-top))",
          paddingLeft: "max(1rem, var(--safe-area-left))",
          paddingRight: "max(1rem, var(--safe-area-right))"
        }}
      >
        <button
          type="button"
          aria-label={openLabel}
          onClick={onOpen}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover"
        >
          <Menu size={18} strokeWidth={1.5} />
        </button>
        {leading}
        {hasTitle ? (
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-medium uppercase tracking-normal text-bd-text-muted">{eyebrow}</p>
            ) : null}
            {title ? (
              <p className="truncate font-heading text-base text-bd-text-heading">{title}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
);

type MobileSidebarDrawerProps = {
  isOpen: boolean;
  ariaLabel?: string;
  closeBackdropLabel: string;
  onClose: () => void;
  children: ReactNode;
};

export function MobileSidebarDrawer({
  isOpen,
  ariaLabel,
  closeBackdropLabel,
  onClose,
  children,
}: MobileSidebarDrawerProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button
        type="button"
        aria-label={closeBackdropLabel}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="absolute left-0 top-0 h-full w-[300px] transform transition-transform duration-300">
        {children}
      </div>
    </div>
  );
}
