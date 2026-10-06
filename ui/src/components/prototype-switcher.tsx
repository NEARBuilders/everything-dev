import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect } from "react";

interface PrototypeVariant {
  key: string;
  name?: string;
}

interface PrototypeSwitcherProps {
  variants: readonly PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
  children?: ReactNode;
}

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  children,
}: PrototypeSwitcherProps) {
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  );
  const active = variants[index];

  const step = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    if (next) onChange(next.key);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div
      data-testid="prototype-switcher"
      className="fixed bottom-4 left-1/2 z-100 flex max-w-full -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-full bg-foreground p-1 text-sm text-background shadow-2xl"
    >
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="Previous variant"
        className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-background/15"
      >
        <CaretLeftIcon className="size-4" />
      </button>
      <span className="min-w-36 px-1 text-center font-mono text-xs">
        {active?.key}
        {active?.name ? ` (${active.name})` : ""}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Next variant"
        className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-background/15"
      >
        <CaretRightIcon className="size-4" />
      </button>
      {children}
    </div>
  );
}

export function PrototypeSwitcherOption({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 font-mono text-xs aria-pressed:bg-background aria-pressed:text-foreground hover:bg-background/15 aria-pressed:hover:bg-background"
    >
      {children}
    </button>
  );
}
