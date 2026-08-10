import type { ThemePickerOption } from "./themeRef.mjs";

export type ThemePickerDomOption = ThemePickerOption & { unavailable?: boolean };

export interface ThemePickerDom {
  element: HTMLDivElement;
  getValue: () => string;
  setDisabled: (disabled: boolean) => void;
  setOptions: (options: ThemePickerDomOption[], value?: string) => void;
}

export type ThemePickerDomVariant = "chips" | "compact-popover";

/** Shared Theme picker for standalone windows and non-React surfaces. */
export function createThemePicker({
  label,
  onChange,
  variant = "chips",
}: {
  label: string;
  onChange?: (value: string) => void;
  variant?: ThemePickerDomVariant;
}): ThemePickerDom {
  const element = document.createElement("div");
  element.className = `theme-picker theme-picker-standalone theme-picker-${variant}`;
  element.setAttribute("aria-label", label);
  let options: ThemePickerDomOption[] = [];
  let value = "";
  let disabled = false;
  let expanded = false;

  element.addEventListener("focusout", (event) => {
    if (!expanded || element.contains(event.relatedTarget as Node | null)) return;
    // 開閉のたびにtrigger/menuを作り直すため、focus中のtriggerが外れて一瞬relatedTarget無しの
    // focusoutが出る。ここで即閉じると開いた直後にmenuが消えるので、focusの落ち着き先で判定する。
    queueMicrotask(() => {
      if (!expanded || element.contains(document.activeElement)) return;
      expanded = false;
      render();
    });
  });

  function colorDot(option: ThemePickerDomOption): HTMLSpanElement {
    const dot = document.createElement("span");
    dot.className = "theme-picker-color";
    dot.setAttribute("aria-hidden", "true");
    dot.style.setProperty("--theme-picker-color", option.colorToken ? `var(--color-${option.colorToken})` : "var(--color-border-strong)");
    return dot;
  }

  function optionLabel(option: ThemePickerDomOption): HTMLSpanElement {
    const text = document.createElement("span");
    text.className = "theme-picker-label";
    text.textContent = option.label;
    return text;
  }

  function select(next: string): void {
    value = next;
    expanded = false;
    render();
    if (variant === "compact-popover") queueMicrotask(() => element.querySelector<HTMLButtonElement>(".theme-picker-trigger")?.focus());
    onChange?.(value);
  }

  function renderCompact(): void {
    const selected = options.find((option) => option.value === value) || options[0];
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "theme-picker-trigger";
    trigger.disabled = disabled || !selected;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", String(expanded));
    trigger.dataset.unavailable = String(Boolean(selected?.unavailable));
    trigger.title = selected?.label || label;
    if (selected) trigger.append(colorDot(selected), optionLabel(selected));
    const caret = document.createElement("span");
    caret.className = "theme-picker-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "⌄";
    trigger.append(caret);
    trigger.addEventListener("click", () => {
      expanded = !expanded;
      render();
      if (expanded) element.querySelector<HTMLButtonElement>(".theme-picker-option.is-selected")?.focus();
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        expanded = true;
        render();
        element.querySelector<HTMLButtonElement>(".theme-picker-option.is-selected")?.focus();
      }
    });

    const menu = document.createElement("div");
    menu.className = "theme-picker-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", label);
    menu.hidden = !expanded;
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `theme-picker-option${option.value === value ? " is-selected" : ""}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === value));
      button.title = option.label;
      button.disabled = disabled || Boolean(option.unavailable);
      button.append(colorDot(option), optionLabel(option));
      const marker = document.createElement("span");
      marker.className = "theme-picker-selected-marker";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = option.value === value ? "✓" : "";
      button.append(marker);
      button.addEventListener("click", () => select(option.value));
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const buttons = [...element.querySelectorAll<HTMLButtonElement>(".theme-picker-option")];
          const index = buttons.indexOf(button);
          buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          expanded = false;
          render();
          element.querySelector<HTMLButtonElement>(".theme-picker-trigger")?.focus();
        }
      });
      menu.append(button);
    }
    element.replaceChildren(trigger, menu);
  }

  function render(): void {
    if (variant === "compact-popover") {
      renderCompact();
      return;
    }
    element.setAttribute("role", "group");
    element.replaceChildren(...options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `theme-chip${option.value === value ? " is-selected" : ""}`;
      button.append(colorDot(option), optionLabel(option));
      button.setAttribute("aria-pressed", String(option.value === value));
      button.disabled = disabled;
      button.addEventListener("click", () => {
        select(option.value);
      });
      return button;
    }));
  }

  return {
    element,
    getValue: () => value,
    setDisabled(next) {
      disabled = next;
      if (disabled) expanded = false;
      render();
    },
    setOptions(next, nextValue) {
      options = next;
      value = nextValue && options.some((option) => option.value === nextValue)
        ? nextValue
        : options[0]?.value || "";
      render();
    },
  };
}
