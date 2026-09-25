import { type ComponentProps, memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { remarkCallouts } from "@/lib/remarkCallouts";
import { projectFileLink } from "@/lib/chatLinks";
import { act, useUi } from "@/lib/store";
import { ChatBlockquote, ChatTable } from "./ChatBlocks";

const REMARK_PLUGINS = [remarkGfm, remarkCallouts];

/**
 * An https link opens in the browser and a link to a project file opens it in the inspector. Any other link
 * has nowhere to go, so it stays plain text instead of a link that does nothing (W12).
 */
function ChatLink({ href, children }: ComponentProps<"a">) {
  const file = useUi((s) => (href && !href.startsWith("https://") ? projectFileLink(href, s.app?.project) : null));
  if (!href || (!href.startsWith("https://") && !file)) return <span title={href}>{children}</span>;
  return (
    <a
      href={href}
      title={file ? `Apri ${file} nell'ispettore` : undefined}
      onClick={(event) => {
        event.preventDefault();
        if (file) useUi.getState().setInspector({ kind: "file", path: file });
        else void act("shell:openExternal", { url: href });
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
