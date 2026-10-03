import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const variants = {
  narrow: "max-w-2xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
} as const;

type PageContainerVariant = keyof typeof variants;

interface PageContainerProps {
  variant?: PageContainerVariant;
  children: ReactNode;
  className?: string;
}

export function PageContainer({ variant = "default", children, className }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-10 px-4 py-8 sm:gap-12 sm:px-8 sm:py-12",
        variants[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
