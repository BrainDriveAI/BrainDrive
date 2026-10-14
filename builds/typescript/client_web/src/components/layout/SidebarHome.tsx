import { Home } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function SidebarHome({ onGoHome }: { onGoHome: () => void }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Home"
            onClick={onGoHome}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-bd-text-secondary transition-colors hover:bg-bd-bg-hover hover:text-bd-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
          >
            <Home size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>Home</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
