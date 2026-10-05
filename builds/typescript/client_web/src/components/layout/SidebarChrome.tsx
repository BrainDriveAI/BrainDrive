import { ChevronLeft, X } from "lucide-react";
import type { ReactNode } from "react";

export default function SidebarChrome({ onGoHome, onToggle, onClose, closeLabel = "Close sidebar", children }: {
  onGoHome: () => void;
  onToggle: () => void;
  onClose?: () => void;
  closeLabel?: string;
  children: ReactNode;
}) {
  return (
    <aside className="flex h-dvh w-[300px] flex-col border-r border-bd-border bg-bd-bg-secondary transition-all duration-200 md:w-sidebar">
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <button
          type="button"
          aria-label="Go to BrainDrive home"
          onClick={onGoHome}
          className="cursor-pointer bg-transparent p-0 hover:opacity-80"
        >
          <img src="/braindrive-logo.svg" alt="BrainDrive" className="h-7 w-auto" />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Collapse sidebar"
            onClick={onToggle}
            className="hidden text-bd-text-muted transition-colors duration-200 hover:text-bd-text-secondary md:inline-flex"
          >
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          {onClose ? (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover md:hidden"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          ) : null}
        </div>
      </div>

      {children}
    </aside>
  );
}
