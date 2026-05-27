import { CheckSquare, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { getOwnerTodo } from "@/api/gateway-adapter";

const REFRESH_INTERVAL_MS = 10_000;
const MAX_PREVIEW = 3;

export default function YourTodoRow() {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await getOwnerTodo();
        if (!cancelled) {
          setContent(next);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setContent(null);
          setIsLoading(false);
        }
      }
    }

    void load();
    const handle = window.setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const items = parseUncheckedTodos(content);
  const visible = items.slice(0, MAX_PREVIEW);
  const overflow = items.length - visible.length;

  return (
    <div className="pt-2">
      <button
        type="button"
        aria-label="Your To-Do"
        title="me/todo.md"
        className="flex w-full items-start gap-3 rounded-xl py-2 pl-4 pr-3 text-left text-bd-text-secondary transition-all duration-200 hover:bg-bd-bg-hover hover:text-bd-text-primary"
      >
        <CheckSquare size={17} strokeWidth={1.5} className="mt-0.5 shrink-0 text-bd-text-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-bd-text-primary">Your To-Do</div>
          {isLoading ? null : items.length === 0 ? (
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-bd-text-muted">
              No todos yet — your agent will add things here as you work together.
            </div>
          ) : (
            <ul className="mt-1 space-y-1">
              {visible.map((text, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 text-[12px] leading-4 text-bd-text-secondary"
                >
                  <Square size={11} strokeWidth={1.5} className="mt-0.5 shrink-0 text-bd-text-muted" />
                  <span className="line-clamp-2">{text}</span>
                </li>
              ))}
              {overflow > 0 && (
                <li className="pl-[19px] text-[11px] text-bd-text-muted">+{overflow} more</li>
              )}
            </ul>
          )}
        </div>
      </button>
    </div>
  );
}

export function parseUncheckedTodos(markdown: string | null): string[] {
  if (!markdown) {
    return [];
  }
  const items: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/);
    if (match) {
      items.push(stripInlineTags(match[1]));
    }
  }
  return items;
}

function stripInlineTags(text: string): string {
  return text.replace(/\s+#[A-Za-z0-9_-]+/g, "").trim();
}
