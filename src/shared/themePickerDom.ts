export interface ThemePickerDomOption {
  value: string;
  label: string;
  kind: "personal" | "theme" | "none";
}

export interface ThemePickerDom {
  element: HTMLDivElement;
  getValue: () => string;
  setDisabled: (disabled: boolean) => void;
  setOptions: (options: ThemePickerDomOption[], value?: string) => void;
}

/** Shared chip-based Theme picker for standalone windows and non-React surfaces. */
export function createThemePicker({
  label,
  onChange,
}: {
  label: string;
  onChange?: (value: string) => void;
}): ThemePickerDom {
  const element = document.createElement("div");
  element.className = "theme-picker theme-picker-standalone";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", label);
  let options: ThemePickerDomOption[] = [];
  let value = "";
  let disabled = false;

  function render(): void {
    element.replaceChildren(...options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `theme-chip${option.value === value ? " is-selected" : ""}`;
      button.textContent = option.label;
      button.setAttribute("aria-pressed", String(option.value === value));
      button.disabled = disabled;
      button.addEventListener("click", () => {
        value = option.value;
        render();
        onChange?.(value);
      });
      return button;
    }));
  }

  return {
    element,
    getValue: () => value,
    setDisabled(next) {
      disabled = next;
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
