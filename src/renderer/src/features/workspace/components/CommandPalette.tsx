import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { IconCommand, IconSearch } from "@tabler/icons-react";

import {
  filterCommandEntries,
  prepareCommandEntries,
} from "../../../../../shared/commandPalette.mjs";

export type CommandPaletteCategory =
  | "Commands"
  | "Tasks"
  | "Plans / Milestones"
  | "Notes / Documents"
  | "Waiting / Inbox"
  | "Knowledge / Chat"
  | "Themes"
  | "Resources / Artifacts";

export interface CommandPaletteExecutionContext {
  trigger: HTMLElement | null;
}

export interface CommandPaletteEntry {
  id: string;
  label: string;
  keywords: string[];
  category: CommandPaletteCategory;
  context?: string;
  searchText?: string;
  shortcut?: string;
  disabledReason?: string;
  execute: (context?: CommandPaletteExecutionContext) => void | Promise<void>;
}

const RECENT_KEY = "tasken:command-palette:recent:v1";
const RECENT_LIMIT = 8;

function loadRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_LIMIT)));
}

function optionId(entryId: string): string {
  return `command-palette-option-${entryId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

interface CommandPaletteProps {
  open: boolean;
  entries: CommandPaletteEntry[];
  close: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  return <OpenCommandPalette entries={props.entries} close={props.close} />;
}

function OpenCommandPalette({ entries, close }: Omit<CommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>(loadRecent);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const deferredQuery = useDeferredValue(query);
  const resultsPending = query !== deferredQuery;
  const preparedEntries = useMemo(
    () => prepareCommandEntries(entries) as CommandPaletteEntry[],
    [entries],
  );

  const groups = useMemo<Array<{ label: string; entries: CommandPaletteEntry[] }>>(() => {
    if (deferredQuery.trim()) {
      const matches = filterCommandEntries(preparedEntries, deferredQuery) as CommandPaletteEntry[];
      const categories = [...new Set(matches.map((entry) => entry.category))];
      return categories.map((category) => ({
        label: category,
        entries: matches.filter((entry) => entry.category === category),
      }));
    }
    const recent = recentIds
      .map((id) => entries.find((entry) => entry.id === id))
      .filter((entry): entry is CommandPaletteEntry => Boolean(entry));
    const recentSet = new Set(recent.map((entry) => entry.id));
    const remaining = preparedEntries.filter(
      (entry) => entry.category === "Commands" && !recentSet.has(entry.id),
    );
    const categories = [...new Set(remaining.map((entry) => entry.category))];
    return [
      ...(recent.length ? [{ label: "Recent", entries: recent }] : []),
      ...categories.map((category) => ({
        label: category,
        entries: remaining.filter((entry) => entry.category === category),
      })),
    ];
  }, [deferredQuery, entries, preparedEntries, recentIds]);
  const flatEntries = groups.flatMap((group) => group.entries);
  const entryIndexes = useMemo(
    () => new Map(flatEntries.map((entry, index) => [entry.id, index])),
    [flatEntries],
  );
  const selectedOptionId = flatEntries[selectedIndex]
    ? optionId(flatEntries[selectedIndex].id)
    : undefined;

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (selectedIndex < flatEntries.length) return;
    setSelectedIndex(Math.max(0, flatEntries.length - 1));
  }, [flatEntries.length, selectedIndex]);

  useEffect(() => {
    if (!selectedOptionId) return;
    document.getElementById(selectedOptionId)?.scrollIntoView({ block: "nearest" });
  }, [selectedOptionId]);

  function closePalette(restoreFocus: boolean) {
    close();
    if (restoreFocus) {
      window.requestAnimationFrame(() =>
        previousFocusRef.current?.focus?.({ preventScroll: true }),
      );
    }
  }

  async function run(entry: CommandPaletteEntry) {
    if (resultsPending || entry.disabledReason) return;
    try {
      await entry.execute({ trigger: previousFocusRef.current });
      const nextRecent = [entry.id, ...recentIds.filter((id) => id !== entry.id)].slice(
        0,
        RECENT_LIMIT,
      );
      setRecentIds(nextRecent);
      saveRecent(nextRecent);
      closePalette(false);
    } catch (cause) {
      setError(`実行できませんでした。${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) closePalette(true);
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
            event.preventDefault();
            event.stopPropagation();
            closePalette(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closePalette(true);
          } else if (event.key === "Tab") {
            event.preventDefault();
            inputRef.current?.focus();
          } else if (event.key === "ArrowDown" && flatEntries.length) {
            event.preventDefault();
            setSelectedIndex((current) => (current + 1) % flatEntries.length);
          } else if (event.key === "ArrowUp" && flatEntries.length) {
            event.preventDefault();
            setSelectedIndex((current) => (current - 1 + flatEntries.length) % flatEntries.length);
          } else if (event.key === "Enter" && flatEntries[selectedIndex]) {
            event.preventDefault();
            void run(flatEntries[selectedIndex]);
          }
        }}
      >
        <div className="command-palette-search">
          <IconSearch size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
              setError("");
            }}
            placeholder="Task、Plan、Note、Waiting、記録、Knowledgeを検索"
            aria-label="Tasken全体を検索"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="command-palette-results"
            aria-activedescendant={selectedOptionId}
          />
          <kbd>Esc</kbd>
        </div>
        {error && (
          <p className="command-palette-error" role="alert">
            {error}
          </p>
        )}
        <p className="command-palette-result-status" role="status" aria-live="polite">
          {resultsPending
            ? "検索中…"
            : query.trim()
              ? `${flatEntries.length}件`
              : "最近使った項目とコマンド"}
        </p>
        <div
          className="command-palette-results"
          id="command-palette-results"
          role="listbox"
          aria-busy={resultsPending}
        >
          {groups.map((group) => (
            <section key={group.label} className="command-palette-group">
              <h3>{group.label}</h3>
              {group.entries.map((entry) => {
                const index = entryIndexes.get(entry.id) ?? 0;
                const selected = index === selectedIndex;
                return (
                  <button
                    key={entry.id}
                    id={optionId(entry.id)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    className={selected ? "is-selected" : ""}
                    disabled={resultsPending || Boolean(entry.disabledReason)}
                    title={resultsPending ? "検索結果を更新しています。" : entry.disabledReason}
                    onPointerMove={() => setSelectedIndex(index)}
                    onClick={() => void run(entry)}
                  >
                    <IconCommand size={16} aria-hidden="true" />
                    <span>
                      <strong>{entry.label}</strong>
                      {entry.context ? (
                        <small>{entry.context}</small>
                      ) : entry.disabledReason ? (
                        <small>{entry.disabledReason}</small>
                      ) : null}
                    </span>
                    {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
                  </button>
                );
              })}
            </section>
          ))}
          {!flatEntries.length && (
            <div className="command-palette-empty">
              <strong>一致する項目はありません</strong>
              <span>別の言葉で検索してください。</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
