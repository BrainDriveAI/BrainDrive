// Native navigation treatment, shared by installed workspace navigation.
export const sidebarStyles = {
  itemRadius: "rounded-md",
  nav: "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-all duration-200 hover:bg-bd-bg-hover",
  conversation: "mb-3 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-all duration-200 hover:bg-bd-bg-hover",
  file: "flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-bd-text-primary transition-colors duration-200 hover:bg-bd-bg-hover",
} as const;
