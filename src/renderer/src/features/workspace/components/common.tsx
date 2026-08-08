import { IconChevronDown, IconInfoCircle } from "@tabler/icons-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { ROUTE_ICONS } from "../../../pages/routeIcons";
import { routeDescription, routeLabel } from "../../../pages/routes";
import type { BaseRecord, DrawerConfig, Theme } from "../types";
import { statusTone, themeColor } from "../lib/domain";
import { PERSONAL_DEFAULT_THEME_ID } from "../../../../../shared/themeRef.mjs";

export type CloseDrawer = (next?: DrawerConfig | null) => void;
export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  tone?: "danger";
  disabled?: boolean;
};

/**
 * 画面の用途説明は常時表示せず、見出し横のinfoから必要なときだけ開く（#302）。
 * subtitleは「今の状態」を示す短い文だけに使う。
 */
export function PageInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(".page-info")) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="page-info">
      <button
        type="button"
        className="page-info-button"
        aria-label="この画面について"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <IconInfoCircle size={16} stroke={1.8} aria-hidden />
      </button>
      {open && <span className="page-info-popover" id={id} role="note">{text}</span>}
    </span>
  );
}

/**
 * routeを渡すと画面名・用途説明・アイコンを正本（ROUTE_META / ROUTE_ICONS）から取る（#301）。
 * titleを直接渡すのは、Theme詳細のように利用者データを見出しにする画面だけにする。
 */
export function PageHeader({ route, title, subtitle, info, children }: {
  route?: string;
  title?: string;
  subtitle?: string;
  info?: string;
  children?: ReactNode;
}) {
  const heading = title || (route ? routeLabel(route) : "");
  const description = info ?? (route ? routeDescription(route) : undefined);
  const HeadingIcon = route ? ROUTE_ICONS[route] : undefined;
  return (
    <header className="page-header">
      <div>
        <h1>
          {HeadingIcon && <HeadingIcon className="page-header-icon" size={20} stroke={1.8} aria-hidden="true" />}
          {heading}
          {description && <PageInfo text={description} />}
        </h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

/**
 * ツールバーの低頻度操作をまとめる共通メニュー（#300）。
 * 幅によって出し入れせず常設し、主要操作の位置が幅で入れ替わらないようにする。
 */
export function ToolbarOverflow({ label, ariaLabel, children }: {
  label: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(".toolbar-overflow")) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="toolbar-overflow">
      <button
        type="button"
        className={`secondary-button compact ${open ? "is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        <IconChevronDown size={14} stroke={1.8} aria-hidden="true" />
      </button>
      {/* 表示切替（checkbox）は続けて操作できるよう開いたままにし、
          一度きりの操作（menuitem）は実行したら閉じる。 */}
      {open && (
        <span
          className="toolbar-overflow-menu"
          id={id}
          role="menu"
          aria-label={ariaLabel}
          onClick={(event) => {
            if ((event.target as HTMLElement | null)?.closest("[role=\"menuitem\"]")) setOpen(false);
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

export function StatusBadge({ value, label }: { value?: string; label?: ReactNode }) {
  return <span className={`status-badge ${statusTone(value)}`}>{label || value || "未設定"}</span>;
}

export function Metric({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={`metric-card panel ${tone}`}>
      <span>{label}</span>
      <strong className="metric-value">{value}</strong>
    </div>
  );
}

export function EmptyState({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {action && onAction && <button className="secondary-button compact" onClick={onAction}>{action}</button>}
    </div>
  );
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const left = Math.max(8, Math.min(x, window.innerWidth - 280));
  const top = Math.max(8, Math.min(y, window.innerHeight - 280));

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="context-menu" style={{ left, top }} role="menu" onContextMenu={(event) => event.preventDefault()}>
      {items.map((item) => (
        <button
          key={item.label}
          className={item.tone === "danger" ? "is-danger" : ""}
          disabled={item.disabled}
          onClick={(event) => {
            event.stopPropagation();
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          role="menuitem"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SimpleRows({
  records = [],
  onOpen,
  meta,
}: {
  records?: BaseRecord[];
  onOpen: (record: BaseRecord) => void;
  meta: (record: BaseRecord) => ReactNode;
}) {
  return (
    <>
      {records.map((record) => (
        <button className="wide-row" key={record.id} onClick={() => onOpen(record)}>
          <strong>{String(record.title ?? record.name ?? record.summary ?? "")}</strong>
          <span>{meta(record)}</span>
        </button>
      ))}
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>;
}

export function ThemeSelect({
  themes = [],
  value,
  allowPersonal = false,
  allowAll = false,
  fieldName = "theme_id",
  onChange,
}: {
  themes?: Theme[];
  value?: string | null;
  allowPersonal?: boolean;
  allowAll?: boolean;
  fieldName?: string;
  onChange?: (value: string) => void;
}) {
  const initialValue = !value && allowPersonal && !allowAll ? PERSONAL_DEFAULT_THEME_ID : (value || "");
  const [selected, setSelected] = useState(initialValue);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setSelected(!value && allowPersonal && !allowAll ? PERSONAL_DEFAULT_THEME_ID : (value || ""));
  }, [allowAll, allowPersonal, value]);
  function choose(next: string) {
    // Keep the native form boundary coherent before React commits the state
    // update. This matters for programmatic requestSubmit() and for the same
    // click-to-submit path used by detached windows.
    if (hiddenInputRef.current) hiddenInputRef.current.value = next;
    setSelected(next);
    onChange?.(next);
  }
  const noneLabel = allowAll ? "全体共通" : "未設定";
  return (
    <Field label="Theme">
      <input ref={hiddenInputRef} type="hidden" name={fieldName} value={selected} readOnly />
      <div className="theme-chips">
        {allowPersonal ? (
          <button
            type="button"
            className={`theme-chip ${selected === PERSONAL_DEFAULT_THEME_ID ? "is-selected" : ""}`}
            onClick={() => choose(PERSONAL_DEFAULT_THEME_ID)}
          >
            個人業務
          </button>
        ) : (
          <button
            type="button"
            className={`theme-chip ${!selected ? "is-selected" : ""}`}
            onClick={() => choose("")}
          >
            {noneLabel}
          </button>
        )}
        {themes.filter((theme) => theme.id !== PERSONAL_DEFAULT_THEME_ID).map((theme, index) => (
          <button
            key={theme.id}
            type="button"
            className={`theme-chip ${selected === theme.id ? "is-selected" : ""}`}
            style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
            onClick={() => choose(theme.id)}
          >
            <span className="chip-dot" />
            {theme.name}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function HubTabs({ tabs, route, navigate }: { tabs: readonly (readonly [string, string])[]; route: string; navigate: (id: string) => void }) {
  return (
    <nav className="hub-tabs" aria-label="サブナビゲーション">
      {tabs.map(([id, label]) => (
        <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>{label}</button>
      ))}
    </nav>
  );
}

export function DrawerHeader({ title, close }: { title: string; close: CloseDrawer }) {
  return (
    <div className="drawer-header">
      <strong>{title}</strong>
      <button onClick={() => close()}>閉じる</button>
    </div>
  );
}
