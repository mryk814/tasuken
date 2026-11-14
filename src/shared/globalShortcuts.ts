/** OS全体で受けるショートカット。どれも記録の窓（Quick Capture）を開くだけ。 */
export const DIRECT_SHORTCUT_DEFINITIONS = [
  { id: "quick-capture", label: "Quick Capture", accelerator: "CommandOrControl+Shift+N" },
  { id: "today-task", label: "Taskを追加", accelerator: "CommandOrControl+Shift+M" },
  { id: "done-task", label: "完了Taskを記録", accelerator: "CommandOrControl+Shift+," },
  { id: "micro-memo", label: "Micro Memoを記録", accelerator: "CommandOrControl+Shift+." },
] as const;

export function formatShortcutLabel(accelerator: string, platform = ""): string {
  const isMac = /mac/i.test(platform);
  const labels: Record<string, string> = {
    CommandOrControl: isMac ? "⌘" : "Ctrl",
    Command: isMac ? "⌘" : "Command",
    Control: isMac ? "⌃" : "Ctrl",
    Ctrl: isMac ? "⌃" : "Ctrl",
    Option: isMac ? "⌥" : "Alt",
    Alt: isMac ? "⌥" : "Alt",
    Shift: isMac ? "⇧" : "Shift",
    Space: "Space",
    Meta: isMac ? "⌘" : "Meta",
    Super: isMac ? "⌘" : "Super",
  };
  const parts = accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => labels[part] || part);
  return parts.join(isMac ? "" : "+");
}
