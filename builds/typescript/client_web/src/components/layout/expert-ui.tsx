import { Dialog } from "radix-ui";
import { X } from "lucide-react";

export const expertButton = "min-h-11 rounded-lg border border-bd-border px-4 py-2 text-sm text-bd-text-primary hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber disabled:opacity-50";
export function ExpertDialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-[680px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-bd-border bg-bd-bg-primary p-5 text-bd-text-primary shadow-xl sm:p-7">
      <div className="flex items-start justify-between gap-3"><Dialog.Title className="font-heading text-xl text-bd-text-heading">{title}</Dialog.Title><Dialog.Close aria-label="Close" className={expertButton}><X size={18} /></Dialog.Close></div>
      <Dialog.Description className="mt-2 pr-5 text-sm leading-relaxed text-bd-text-secondary">{description}</Dialog.Description>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
