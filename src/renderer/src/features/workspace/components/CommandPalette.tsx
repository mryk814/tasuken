import { useEffect, useMemo, useRef, useState } from "react";
import { IconCommand, IconSearch } from "@tabler/icons-react";

import { filterCommandEntries } from "../../../../../shared/commandPalette.mjs";

export type CommandPaletteCategory =
  | "Commands"
  | "Tasks"
  | "Notes / Documents"
  | "Themes"
  | "Resources / Artifacts";

export interface CommandPaletteEntry {
  id: string;
  label: string;
  keywords: string[];
  category: CommandPaletteCategory;
  shortcut?: string;
  disabledReason?: string;
  execute: () => void | Promise<void>;
}

const RECENT_KEY = "tasken:command-palette:recent:v1";
const RECENT_LIMIT = 8;

function loadRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_LIMIT)));
}

export function CommandPalette({
  open,
  entries,
  close,
}: {
  open: boolean;
  entries: CommandPaletteEntry[];
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>(loadRecent);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const groups = useMemo<Array<{ label: string; entries: CommandPaletteEntry[] }>>(() => {
    const matches = filterCommandEntries(entries, query) as CommandPaletteEntry[];
    if (query.trim()) {
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
    const remaining = matches.filter((entry) => !recentSet.has(entry.id));
    const categories = [...new Set(remaining.map((entry) => entry.category))];
    return [
      ...(recent.length ? [{ label: "Recent", entries: recent }] : []),
      ...categories.map((category) => ({
        label: category,
        entries: remaining.filter((entry) => entry.category === category),
      })),
    ];
  }, [entries, query, recentIds]);
  const flatEntries = groups.flatMap((group) => group.entries);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setSelectedIndex(0);
    setError("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open || selectedIndex < flatEntries.length) return;
    setSelectedIndex(Math.max(0, flatEntries.length - 1));
  }, [flatEntries.length, open, selectedIndex]);

  function closePalette(restoreFocus: boolean) {
    close();
    if (restoreFocus) {
      window.requestAnimationFrame(() => previousFocusRef.current?.focus?.({ preventScroll: true }));
    }
  }

  async function run(entry: CommandPaletteEntry) {
    if (entry.disabledReason) return;
    try {
      await entry.execute();
      const nextRecent = [entry.id, ...recentIds.filter((id) => id !== entry.id)].slice(0, RECENT_LIMIT);
      setRecentIds(nextRecent);
      saveRecent(nextRecent);
      closePalette(false);
    } catch (cause) {
      setError(`実行できませんでした。${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  if (!open) return null;
  return (
    <div className="command-palette-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target) closePalette(true);
    }}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
            event.preventDefault();
            event.stopPropagation();
            closePalette(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            closePalette(true);
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
            placeholder="コマンド、Task、Note、Themeを検索"
            aria-label="コマンドを検索"
            aria-controls="command-palette-results"
          />
          <kbd>Esc</kbd>
        </div>
        {error && <p className="command-palette-error" role="alert">{error}</p>}
        <div className="command-palette-results" id="command-palette-results" role="listbox">
          {groups.map((group) => (
            <section key={group.label} className="command-palette-group">
              <h3>{group.label}</h3>
              {group.entries.map((entry) => {
                const index = flatEntries.indexOf(entry);
                const selected = index === selectedIndex;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? "is-selected" : ""}
                    disabled={Boolean(entry.disabledReason)}
                    title={entry.disabledReason}
                    onPointerMove={() => setSelectedIndex(index)}
                    onClick={() => void run(entry)}
                  >
                    <IconCommand size={16} aria-hidden="true" />
                    <span>
                      <strong>{entry.label}</strong>
                      {entry.disabledReason && <small>{entry.disabledReason}</small>}
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
