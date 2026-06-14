import type { ReactNode } from "react";

import type { BaseRecord, DrawerConfig, Item, Theme } from "../types";
import { statusTone } from "../lib/domain";

export type CloseDrawer = (next?: DrawerConfig | null) => void;

export function PageHeader({ title, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  // subtitleは受け取るが、既存挙動どおりタイトルと操作のみ描画する。
  return (
    <header className="page-header">
      <h1>{title}</h1>
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

export function EmptyState({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <button className="secondary-button compact" onClick={onAction}>{action}</button>
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
}: {
  themes?: Theme[];
  value?: string | null;
  allowPersonal?: boolean;
  allowAll?: boolean;
}) {
  return (
    <Field label="Theme">
      <select name="theme_id" defaultValue={value || ""}>
        <option value="">{allowAll ? "全体共通" : allowPersonal ? "個人業務 / Themeなし" : "未設定"}</option>
        {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
      </select>
    </Field>
  );
}

export function ItemSelect({
  items = [],
  value,
  label = "関連Item",
}: {
  items?: Item[];
  value?: string | null;
  label?: string;
}) {
  return (
    <Field label={label}>
      <select name={label === "親Item" ? "parent_item_id" : "item_id"} defaultValue={value || ""}>
        <option value="">未設定</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </Field>
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
