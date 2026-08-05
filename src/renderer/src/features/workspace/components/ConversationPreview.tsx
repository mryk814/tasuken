import { IconSparkles, IconTerminal2, IconTool, IconUser } from "@tabler/icons-react";
import { useMemo } from "react";

import { parseConversation, type ConversationMessage } from "../lib/conversationParser";
import { previewHtml } from "../lib/markdown";
import { MarkdownPreview } from "./MarkdownPreview";

function RoleIcon({ role }: { role: ConversationMessage["role"] }) {
  if (role === "user") return <IconUser size={14} />;
  if (role === "tool") return <IconTool size={14} />;
  if (role === "system") return <IconTerminal2 size={14} />;
  return <IconSparkles size={14} />;
}

export function ConversationPreview({ body, className, showCount = true }: { body: string; className?: string; showCount?: boolean }) {
  const parsed = useMemo(() => parseConversation(body), [body]);

  if (!parsed.messages.length) {
    return <MarkdownPreview className={className || "markdown-preview"} html={previewHtml(body, "markdown")} />;
  }

  return (
    <div className={`conversation-view ${className || ""}`}>
      {showCount && <p className="conversation-message-count">{parsed.messageCount}件のメッセージ</p>}
      <div className="conversation-thread">
        {parsed.messages.map((msg, i) => (
          <article key={i} className={`conversation-turn conversation-role-${msg.role}`}>
            <div className="conversation-turn-label">
              <RoleIcon role={msg.role} />
              <span>{msg.displayName}</span>
            </div>
            <div className="conversation-turn-body">
              <MarkdownPreview className="markdown-preview" html={previewHtml(msg.content, "markdown")} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
