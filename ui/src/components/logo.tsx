import { cn } from "cn";

interface LogoProps {
  appName?: string;
  showText?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
  mark?: boolean;
}

export function LogoMark({ size = "md", className }: Pick<LogoProps, "size" | "className">) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center bg-brand text-brand-foreground",
        size === "sm"
          ? "size-6 rounded-md"
          : size === "lg"
            ? "size-12 rounded-xl"
            : "size-8 rounded-lg",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-1/2" fill="none" aria-hidden="true">
        <path
          d="M3 13.5V6.5L8 3l5 3.5v7"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="9.5" r="1.75" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({
  appName = "CityNode",
  showText = true,
  className,
  size = "md",
  mark = true,
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark && <LogoMark size={size} />}
      {showText && (
        <span
          className={cn(
            "font-heading font-semibold tracking-tight text-foreground",
            size === "lg" ? "text-xl" : "text-base",
          )}
        >
          {appName}
        </span>
      )}
    </span>
  );
}
