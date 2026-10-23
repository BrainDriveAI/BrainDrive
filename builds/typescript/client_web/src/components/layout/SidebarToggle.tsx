import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Ref } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function SidebarToggle({ isCollapsed, onToggle, buttonRef }: {
  isCollapsed: boolean;
  onToggle: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  const label = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label={label}
            onClick={onToggle}
            className="group relative flex h-11 w-11 items-center justify-center text-bd-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md transition-colors group-hover:bg-bd-bg-hover" />
            <Icon className="relative" size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
