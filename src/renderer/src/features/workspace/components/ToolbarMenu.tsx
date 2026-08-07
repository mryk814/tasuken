import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ToolbarMenuItem =
  | {
    kind?: "action";
    /** 同じlabelが並ぶことがあるので、keyは呼び出し側が決める。 */
    id: string;
    label: string;
    hint?: string;
    disabled?: boolean;
    onSelect: () => void;
  }
  | {
    kind: "toggle";
    id: string;
    label: string;
    hint?: string;
    checked: boolean;
    disabled?: boolean;
    onToggle: (checked: boolean) => void;
  }
  | {
    kind: "group";
    id: string;
    label: string;
  }
  | {
    kind: "custom";
    id: string;
    render: () => ReactNode;
  };

/**
 * toolbarの低頻度操作をまとめる開閉menu（#331）。
 *
 * 高頻度でないactionを同格のbuttonとして並べ続けると、主操作が埋もれ、
 * 狭幅で本文領域を押し潰す（#329）。ここへ畳んで、常設は意味の分かる一つのlabelにする。
 */
export function ToolbarMenu({
  label,
  icon,
  title,
  items,
  align = "right",
  className = "",
}: {
  label: string;
  icon?: ReactNode;
  title?: string;
  items: ToolbarMenuItem[];
  align?: "left" | "right";
  className?: string;
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

  return (
    <div className={`toolbar-menu ${className}`.trim()} ref={anchorRef}>
      <button
        type="button"
        className="secondary-button compact"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={title || label}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        {label}
        <IconChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={`toolbar-menu-list is-${align}`} id={menuId} role="menu" aria-label={label}>
          {items.map((item) => {
            if (item.kind === "group") {
              return <p className="toolbar-menu-group" key={item.id}>{item.label}</p>;
            }
            if (item.kind === "custom") {
              return <div className="toolbar-menu-custom" key={item.id}>{item.render()}</div>;
            }
            if (item.kind === "toggle") {
              return (
                <label className="toolbar-menu-toggle" key={item.id} title={item.hint}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={item.disabled}
                    onChange={(event) => item.onToggle(event.target.checked)}
                  />
                  {item.label}
                </label>
              );
            }
            return (
              <button
                type="button"
                role="menuitem"
                key={item.id}
                disabled={item.disabled}
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
