import { type ComponentProps, memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { remarkCallouts } from "@/lib/remarkCallouts";
import { act } from "@/lib/store";
import { ChatBlockquote, ChatTable } from "./ChatBlocks";

const REMARK_PLUGINS = [remarkGfm, remarkCallouts];

function ChatLink({ href, children }: ComponentProps<"a">) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href?.startsWith("https://")) void act("shell:openExternal", { url: href });
      }}
    >
      {children}
    </a>
  );
}

const INNER = { a: ChatLink };
const COMPONENTS: Components = {
  a: ChatLink,
  blockquote: ChatBlockquote,
  table: (props) => <ChatTable {...props} components={INNER} />,
};

export const ChatMarkdown = memo(function ChatMarkdown({ text, user = false, className }: { text: string; user?: boolean; className?: string }) {
  return (
    <div className={cn("chat-markdown w-full min-w-0 text-foreground", user && "chat-markdown--user", className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
