import { cn } from "cn";

interface OrgMarkProps {
  name: string;
  size?: "sm" | "default";
  className?: string;
}

export function orgInitials(name: string) {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function OrgMark({ name, size = "default", className }: OrgMarkProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-brand-muted font-heading font-semibold text-brand-strong",
        size === "sm" ? "size-6 text-xs" : "size-8 text-sm",
        className,
      )}
    >
      {orgInitials(name)}
    </span>
  );
}
