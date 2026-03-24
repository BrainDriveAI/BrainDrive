import { useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-bd-bg-secondary/80 text-bd-text-muted transition-colors hover:bg-bd-bg-tertiary hover:text-bd-text-primary"
      aria-label="Copy code"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          let codeText = "";
          const codeChild = children as {
            props?: {
              children?: unknown;
            };
          };

          if (codeChild?.props?.children) {
            codeText = typeof codeChild.props.children === "string"
              ? codeChild.props.children
              : String(codeChild.props.children);
          }

          return (
            <div className="group relative my-3">
              <CopyButton code={codeText} />
              <pre className="overflow-x-auto rounded-lg border border-bd-border bg-bd-bg-secondary p-4 text-sm leading-6">
                {children}
              </pre>
            </div>
          );
        },
        code({ className, children, ...props }) {
          const isInline = !className;

          if (isInline) {
            return (
              <code className="rounded bg-bd-bg-secondary px-1.5 py-0.5 text-sm text-bd-amber" {...props}>
                {children}
              </code>
            );
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        h1({ children }) {
          return <h1 className="mb-3 mt-6 text-xl font-semibold text-bd-text-heading">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="mb-2 mt-5 text-lg font-semibold text-bd-text-heading">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="mb-2 mt-4 text-base font-semibold text-bd-text-heading">{children}</h3>;
        },
        p({ children }) {
          return <p className="mb-3 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-3 ml-6 list-disc space-y-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="mb-3 ml-6 list-decimal space-y-1">{children}</ol>;
        },
        li({ children }) {
          return <li className="leading-7">{children}</li>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-3 border-l-2 border-bd-amber/40 pl-4 text-bd-text-secondary">
              {children}
            </blockquote>
          );
        },
        table({ children }) {
          return (
            <div className="my-3 overflow-x-auto rounded-lg border border-bd-border">
              <table className="w-full text-sm">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="bg-bd-bg-secondary text-bd-text-heading">{children}</thead>;
        },
        th({ children }) {
          return <th className="px-3 py-2 text-left font-medium">{children}</th>;
        },
        td({ children }) {
          return <td className="border-t border-bd-border px-3 py-2">{children}</td>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-bd-amber underline underline-offset-2 hover:text-bd-amber/80"
            >
              {children}
            </a>
          );
        },
        hr() {
          return <hr className="my-4 border-bd-border" />;
        },
        strong({ children }) {
          return <strong className="font-semibold text-bd-text-heading">{children}</strong>;
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
