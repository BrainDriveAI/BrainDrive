// Full-screen onboarding conversation — no sidebar, no settings.
// Built but deferred from the V1 flow (D32). Available via "Get to know
// your BrainDrive" suggestion in the empty state. Will wire to Gateway
// conversation in Phase 5.
import { useState } from "react";
import { ArrowUp } from "lucide-react";

type WhyFinderMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const initialMessages: WhyFinderMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Hey — I'm your BrainDrive. Before we jump in, I'd love to get to know you a bit. Not a form, not a quiz — just a conversation.\n\nWhat's on your mind right now? Could be work, a project you're stuck on, something you want to change — whatever's taking up mental space."
  }
];

type WhyFinderScreenProps = {
  onComplete?: () => void;
};

export default function WhyFinderScreen({ onComplete }: WhyFinderScreenProps) {
  void onComplete; // Will be called when AI signals onboarding complete
  const [messages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const trimmed = input.trim();

  return (
    <div className="flex h-dvh flex-col bg-bd-bg-chat">
      {/* Minimal header — logo only */}
      <div className="flex items-center justify-center px-4 py-5">
        <img
          src="/braindrive-logo.svg"
          alt="BrainDrive"
          className="h-8 w-auto"
        />
      </div>

      {/* Messages */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[680px] flex-1 px-4 pb-4">
          {/* Spacer to push first message toward center on short conversations */}
          <div className="flex min-h-[20vh]" />

          {messages.map((msg) => (
            <div key={msg.id} className="mb-6">
              {msg.role === "assistant" ? (
                <div className="text-[15px] leading-relaxed text-bd-text-primary">
                  {msg.content.split("\n\n").map((paragraph, i) => (
                    <p key={i} className={i > 0 ? "mt-4" : ""}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="text-[15px] leading-relaxed text-bd-text-secondary">
                  {msg.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Composer — simpler than main chat, no attach button */}
      <div className="bg-bd-bg-chat px-4 pb-6 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-[680px]">
          <div className="flex items-end gap-2 rounded-[24px] border border-bd-border bg-bd-bg-tertiary p-2">
            <textarea
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                }
              }}
              placeholder="Share what's on your mind..."
              className="max-h-[120px] min-h-[36px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-[15px] text-bd-text-primary outline-none placeholder:text-bd-text-muted"
            />

            <button
              type="button"
              aria-label="Send message"
              disabled={trimmed.length === 0}
              className={[
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bd-amber text-white transition-all duration-200",
                trimmed.length === 0
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-bd-amber-hover"
              ].join(" ")}
            >
              <ArrowUp size={18} strokeWidth={1.5} />
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-bd-text-muted">
            This conversation helps your BrainDrive understand what matters to
            you. Everything stays in your library.
          </p>
        </div>
      </div>
    </div>
  );
}
