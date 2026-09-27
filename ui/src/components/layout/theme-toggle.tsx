import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { ClientOnly } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ className }: { className?: string }) {
  return (
    <ClientOnly
      fallback={
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-hidden
          className={className}
          data-testid="theme-toggle"
        />
      }
    >
      <ThemeToggleButton className={className} />
    </ClientOnly>
  );
}

function ThemeToggleButton({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={className}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      data-testid="theme-toggle"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
