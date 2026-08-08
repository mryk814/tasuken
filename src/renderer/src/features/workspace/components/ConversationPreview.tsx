import { IconTerminal2, IconTool, IconUser } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useUiStore } from "../../../stores/uiStore";
import { AI_ICON } from "../../../pages/semanticIcons";
import { workspaceApi } from "../../../services/workspaceApi";
import { conversationMessageMarkdown, conversationRangeMarkdown, conversationTurnRange } from "../lib/conversationCopy";
import { parseConversation, type ConversationMessage } from "../lib/conversationParser";
import { previewHtml } from "../lib/markdown";
import { MarkdownPreview } from "./MarkdownPreview";

function RoleIcon({ role }: { role: ConversationMessage["role"] }) {
  if (role === "user") return <IconUser size={14} />;
  if (role === "tool") return <IconTool size={14} />;
  if (role === "system") return <IconTerminal2 size={14} />;
  return <AI_ICON size={14} />;
}

export function ConversationPreview({ body, className, showCount = true }: { body: string; className?: string; showCount?: boolean }) {
  const parsed = useMemo(() => parseConversation(body), [body]);
  const setToast = useUiStore((state) => state.setToast);
  // 範囲コピーの起点。#197 / #304 と同じ「message index の範囲」で選択を表す。
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRangeAnchor(null);
  }, [body]);

  // Code block のコピーは renderer が生成したHTML内へ後から差し込む。
  // ボタンは実要素なのでTabで到達でき、クリックは委譲で1つのlistenerに集約する。
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    let frame = 0;

    const decorate = () => {
      for (const pre of Array.from(thread.querySelectorAll<HTMLElement>(".conversation-turn-body pre"))) {
        if (pre.classList.contains("md-mermaid-block")) continue;
        if (pre.querySelector(".conversation-code-copy")) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "conversation-code-copy";
        button.textContent = "コピー";
        const language = pre.querySelector("code")?.className.match(/language-([\w+-]+)/)?.[1];
        button.setAttribute("aria-label", language ? `${language}のコードをコピー` : "コードをコピー");
        pre.classList.add("has-code-copy");
        // 先頭へ置き、floatさせることでコードに重ならず、縦スクロール中も見失わない。
        pre.prepend(button);
      }
    };

    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(".conversation-code-copy");
      if (!button) return;
      event.preventDefault();
      const code = button.closest("pre")?.querySelector("code")?.textContent || "";
      if (!code) {
        setToast("コピーできるコードが見つかりません。", "warning");
        return;
      }
      void workspaceApi.copyText(code).then(() => setToast("コードをコピーしました。", "success"));
    };

    // Mermaid等の遅延描画後に増えたcode blockも拾う。
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(decorate);
    });
    decorate();
    observer.observe(thread, { childList: true, subtree: true });
    thread.addEventListener("click", onClick);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      thread.removeEventListener("click", onClick);
    };
  }, [parsed.messages, setToast]);

  if (!parsed.messages.length) {
    return <MarkdownPreview className={className || "markdown-preview"} html={previewHtml(body, "markdown")} />;
  }

  const messages = parsed.messages;

  function copy(markdown: string, message: string) {
    if (!markdown) {
      setToast("コピーできる本文がありません。", "warning");
      return;
    }
    void workspaceApi.copyText(markdown).then(() => setToast(message, "success"));
  }

  function copyMessage(index: number, withSpeaker: boolean) {
    copy(
      conversationMessageMarkdown(messages[index], { withSpeaker }),
      withSpeaker ? "メッセージを話者込みでコピーしました。" : "メッセージ本文をコピーしました。",
    );
  }

  function copyTurn(index: number) {
    const range = conversationTurnRange(messages, index);
    if (!range) return;
    const selection = conversationRangeMarkdown(messages, range.from, range.to);
    const excluded = selection.excluded ? `（tool・systemの${selection.excluded}件は除外）` : "";
    copy(selection.markdown, `${selection.count}件のやり取りをコピーしました。${excluded}`);
  }

  function copyRange(index: number) {
    if (rangeAnchor === null) return;
    const selection = conversationRangeMarkdown(messages, rangeAnchor, index);
    const excluded = selection.excluded ? `（tool・systemの${selection.excluded}件は除外）` : "";
    setRangeAnchor(null);
    copy(selection.markdown, `${selection.count}件のメッセージをコピーしました。${excluded}`);
  }

  return (
    <div className={`conversation-view ${className || ""}`}>
      {showCount && <p className="conversation-message-count">{parsed.messageCount}件のメッセージ</p>}
      {rangeAnchor !== null && (
        <p className="conversation-range-state" role="status">
          {rangeAnchor + 1}件目を選択中。範囲の終わりで「ここまでコピー」を押してください。
          <button type="button" className="text-button compact" onClick={() => setRangeAnchor(null)}>選択を解除</button>
        </p>
      )}
      <div className="conversation-thread" ref={threadRef}>
        {messages.map((msg, i) => {
          const turn = conversationTurnRange(messages, i);
          const turnSpansMessages = Boolean(turn && turn.to > turn.from);
          return (
            <article key={i} className={`conversation-turn conversation-role-${msg.role}`}>
              <div className="conversation-turn-label">
                <RoleIcon role={msg.role} />
                <span>{msg.displayName}</span>
              </div>
              <div className="conversation-turn-body">
                <MarkdownPreview className="markdown-preview" html={previewHtml(msg.content, "markdown")} />
              </div>
              <div className="conversation-turn-actions">
                <button type="button" className="text-button compact" onClick={() => copyMessage(i, true)}>コピー</button>
                <button type="button" className="text-button compact" onClick={() => copyMessage(i, false)}>本文のみ</button>
                {turnSpansMessages && (
                  <button type="button" className="text-button compact" onClick={() => copyTurn(i)}>このやり取り</button>
                )}
                {rangeAnchor === null ? (
                  <button type="button" className="text-button compact" onClick={() => setRangeAnchor(i)}>ここから選択</button>
                ) : (
                  <button type="button" className="text-button compact" onClick={() => copyRange(i)}>ここまでコピー</button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
