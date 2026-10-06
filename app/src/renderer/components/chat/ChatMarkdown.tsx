import { type ComponentProps, memo, useMemo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseReferenceHref } from "@shared/references";
import { cn } from "@/lib/cn";
import { remarkCallouts } from "@/lib/remarkCallouts";
import { remarkPlainText, remarkReferences } from "@/lib/remarkReferences";
import { projectFileLink } from "@/lib/chatLinks";
import { openReference, useReferenceIndex } from "@/lib/references";
import { useT, useLanguage } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { ChatBlockquote, ChatTable } from "./ChatBlocks";
import { translator } from "@shared/i18n";
import { opensInBrowser } from "@shared/externalLinks";

/** Links to Trama's own records (issue #277) pass; every other URL goes through react-markdown's safe filter. */
const urlTransform = (url: string) => (url.startsWith("trama:ref/") ? url : defaultUrlTransform(url));

/**
 * A reference to a record of Trama opens it inside Trama (issue #277), an https link or the project's local preview
 * opens in the browser and a link to a project file opens it in the inspector. Any other link has nowhere to go, so it stays plain text
 * instead of a link that does nothing (W12).
 */
function ChatLink({ href, children, title, ...rest }: ComponentProps<"a">) {
  const t = useT();
  const reference = href ? parseReferenceHref(href) : null;
  const file = useUi((s) => (href && !reference && !opensInBrowser(href) ? projectFileLink(href, s.app?.project) : null));
  if (reference) {
    return (
      <a
        href={href}
        title={title}
        className="chat-reference"
        data-reference={rest["data-reference" as keyof typeof rest] as string | undefined}
        data-reference-id={rest["data-reference-id" as keyof typeof rest] as string | undefined}
        onClick={(event) => {
          event.preventDefault();
          openReference(reference);
        }}
      >
        {children}
      </a>
    );
  }
  if (!href || (!opensInBrowser(href) && !file)) return <span title={href}>{children}</span>;
  return (
    <a
      href={href}
      title={file ? t("chat.markdown.openFile", { file }) : undefined}
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

/**
 * `plain`: the text is an agent's result or report that Trama shows in a card, made plain for the person (issue #270).
 * Messages, issues and other published text stay as written.
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text, user = false, plain = false, className }: { text: string; user?: boolean; plain?: boolean; className?: string }) {
  const index = useReferenceIndex();
  const language = useLanguage();
  const plugins = useMemo<NonNullable<Options["remarkPlugins"]>>(
    () => [remarkGfm, remarkCallouts, ...(plain ? [[remarkPlainText, { t: translator(language) }] satisfies NonNullable<Options["remarkPlugins"]>[number]] : []), [remarkReferences, { index }]],
    [index, plain, language],
  );
  return (
    <div className={cn("chat-markdown w-full min-w-0 text-foreground", user && "chat-markdown--user", className)}>
      <ReactMarkdown remarkPlugins={plugins} components={COMPONENTS} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
