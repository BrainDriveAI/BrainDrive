import { LayoutGrid, LogOut, Users } from "lucide-react";

type ProfileMenuProps = {
  onClose: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

export default function ProfileMenu({
  onClose,
  onOpenSettings,
  onLogout
}: ProfileMenuProps) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-[12px] border border-bd-border bg-bd-bg-tertiary p-1 shadow-[0_-12px_32px_rgba(0,0,0,0.35)]">
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm text-bd-text-primary transition-all duration-200 hover:bg-bd-bg-hover"
      >
        <LayoutGrid size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
        <span>BrainDrive Settings</span>
      </button>

      <button
        type="button"
        onClick={() => {
          window.open("https://community.braindrive.ai", "_blank", "noopener");
          onClose();
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm text-bd-text-primary transition-all duration-200 hover:bg-bd-bg-hover"
      >
        <Users size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-secondary" />
        <span>BrainDrive Community</span>
      </button>

      <div className="mx-2 my-1 h-px bg-bd-border" />

      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm text-bd-danger transition-all duration-200 hover:bg-bd-bg-hover"
      >
        <LogOut size={16} strokeWidth={1.5} className="shrink-0 text-bd-danger" />
        <span>Log Out</span>
      </button>
    </div>
  );
}
