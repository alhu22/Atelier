import { isValidElement, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CopyButton({ text, label = "Copy reply" }: { text: string; label?: string }) {
  const [feedback, setFeedback] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <button
        aria-label={label}
        className="chat-action"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => setFeedback("Copied"),
            () => setFeedback("Copy failed"),
          );
          if (!navigator.clipboard) setFeedback("Copy unavailable");
        }}
        type="button"
      >Copy</button>
      {feedback && <span className="text-[10px]" role="status">{feedback}</span>}
    </span>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ children?: string }>(children) ? String(children.props.children ?? "") : "";
  return (
    <div className="chat-code">
      <div className="flex justify-end border-b border-border px-2 py-1">
        <CopyButton label="Copy code" text={code.replace(/\n$/, "")} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          a: ({ children, href }) => <a href={href} rel="noopener noreferrer" target="_blank">{children}</a>,
          img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span>,
        }}
      >{content}</Markdown>
    </div>
  );
}
