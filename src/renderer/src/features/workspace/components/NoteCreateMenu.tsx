import { useEffect, useId, useRef, useState } from "react";

import { NOTES_KIND_LABELS, type NotesKind } from "../lib/domain";
import { ActionButton } from "./common";

const CREATE_ORDER: NotesKind[] = ["note", "resource", "report", "prompt"];

/**
 * Notesの作成導線（#313）。
 *
 * 種類ごとにbuttonを4つ並べず、primary actionを一つにする。
 * 既定の種類は現在のfilterから決め、位置と幅は種類が変わっても動かさない。
 */
export function NoteCreateMenu({
  defaultKind,
  onCreate,
}: {
  defaultKind: NotesKind;
  onCreate: (kind: NotesKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choose = (kind: NotesKind) => {
    setOpen(false);
    onCreate(kind);
  };

  return (
    <div className="note-create-menu" ref={anchorRef}>
      <ActionButton
        action="notesCreate"
        className="note-create-primary"
        type="button"
        onClick={() => choose(defaultKind)}
      >
        {NOTES_KIND_LABELS[defaultKind]}を追加
      </ActionButton>
      <ActionButton
        action="notesCreateMenu"
        className="note-create-toggle"
        type="button"
        iconOnly
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="追加する種類を選ぶ"
        title="追加する種類を選ぶ"
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <div className="note-create-list" id={menuId} role="menu" aria-label="追加する種類">
          {CREATE_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className={kind === defaultKind ? "is-active" : ""}
              onClick={() => choose(kind)}
            >
              {NOTES_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
