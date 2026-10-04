import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Native document treatment, shared by installed workspace document pages.
export const documentStyles = {
  header: "border-b border-bd-border/80 bg-bd-bg-chat/90 px-4 py-3 backdrop-blur-sm sm:px-6",
  headerInner: "mx-auto flex w-full max-w-[780px] items-center justify-between gap-3",
  eyebrow: "text-[11px] uppercase tracking-[0.24em] text-bd-text-muted",
  headerActions: "flex shrink-0 items-center gap-2",
  title: "truncate font-heading text-lg text-bd-text-heading",
  secondary: "text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading",
  primary: "bg-bd-amber text-white hover:bg-bd-amber-hover",
  editor: "min-h-[420px] flex-1 resize-none rounded-2xl border border-bd-border bg-bd-bg-secondary px-5 py-4 font-mono text-[14px] leading-7 text-bd-text-primary outline-none transition-colors placeholder:text-bd-text-muted focus:border-bd-amber/60",
  body: "prose-bd max-w-full text-[15px] leading-7 text-bd-text-primary",
} as const;

export function DocumentHeader({ children }: { children: ReactNode }) {
  return (
    <header className={documentStyles.header}>
      <div className={documentStyles.headerInner}>{children}</div>
    </header>
  );
}

export function DocumentButton({ variant = "default", size = "sm", className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(variant === "ghost" ? documentStyles.secondary : documentStyles.primary, className)}
      {...props}
    />
  );
}
