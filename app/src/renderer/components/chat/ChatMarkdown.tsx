import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { act } from "@/lib/store";

export const ChatMarkdown = memo(function ChatMarkdown({ text, user = false, className }: { text: string; user?: boolean; className?: string }) {
  return (
    <div className={cn("chat-markdown w-full min-w-0 text-foreground", user && "chat-markdown--user", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href?.startsWith("https://")) void act("shell:openExternal", { url: href });
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
