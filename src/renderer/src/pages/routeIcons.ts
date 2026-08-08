import {
  IconBulb,
  IconChecklist,
  IconInbox,
  IconMessageCircle,
  IconNotes,
  IconPaperclip,
  IconSettings,
  IconSun,
  IconTimeline,
  IconWriting,
  type Icon,
} from "@tabler/icons-react";
import { AI_ICON } from "./semanticIcons";

/**
 * Sidebarとページ見出しで同じアイコンを使うための正本（#301）。
 * 画面ごとに装飾用の別アイコンを増やさない。
 */
export const ROUTE_ICONS: Record<string, Icon> = {
  today: IconSun,
  todo: IconChecklist,
  inbox: IconInbox,
  timeline: IconTimeline,
  knowledge: IconBulb,
  notes: IconNotes,
  sketch: IconWriting,
  "chat-refs": IconMessageCircle,
  artifacts: IconPaperclip,
  "ai-io": AI_ICON,
  settings: IconSettings,
};
