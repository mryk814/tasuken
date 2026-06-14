import type { Icon } from "@tabler/icons-react";

interface IconLabelProps {
  icon: Icon;
  children: React.ReactNode;
}

export function IconLabel({ icon: IconComponent, children }: IconLabelProps) {
  return (
    <>
      <IconComponent size={16} stroke={1.8} aria-hidden="true" />
      <span>{children}</span>
    </>
  );
}
