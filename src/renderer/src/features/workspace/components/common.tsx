import { type ReactNode, useEffect, useState } from "react";

import type { BaseRecord, DrawerConfig, Theme } from "../types";
import { statusTone, themeColor } from "../lib/domain";

export type CloseDrawer = (next?: DrawerConfig | null) => void;
export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  tone?: "danger";
  disabled?: boolean;
};

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="header-actions">{children}</div>
    </header>
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
  const [selected, setSelected] = useState(value || "");
  useEffect(() => {
    setSelected(value || "");
  }, [value]);
  function choose(next: string) {
    setSelected(next);
    onChange?.(next);
  }
  const noneLabel = allowAll ? "全体共通" : allowPersonal ? "個人業務" : "未設定";
  return (
    <Field label="Theme">
      <input type="hidden" name={fieldName} value={selected} />
      <div className="theme-chips">
        <button
          type="button"
          className={`theme-chip ${!selected ? "is-selected" : ""}`}
          onClick={() => choose("")}
        >
          {noneLabel}
        </button>
        {themes.map((theme, index) => (
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
