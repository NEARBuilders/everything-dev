"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { buttonVariants } from "@/components/ui/button";

const Toaster = ({ richColors: _, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            "flex items-center gap-2 p-3 pr-7 rounded-[12px] min-h-14 relative",
            "bg-popover text-popover-foreground",
            "border-2 border-outset border-border-strong shadow-sm",
            "w-[360px] max-w-[calc(100vw-1.5rem)] group",
          ].join(" "),
          content: "flex flex-col gap-1 flex-1 justify-center group-data-[type=loading]:hidden",
          title: "text-sm font-bold text-foreground",
          description: "text-[11px] text-foreground",
          icon: [
            "flex items-center justify-center h-9 w-9 shrink-0 p-1.5",
            "border-2 border-outset border-border-strong rounded-[8px]",
            "bg-muted text-muted-foreground",
            "group-data-[type=success]:bg-near-green group-data-[type=success]:text-foreground",
            "group-data-[type=error]:text-foreground",
            "group-data-[type=info]:bg-near-blue group-data-[type=info]:text-foreground",
            "group-data-[type=warning]:text-foreground",
          ].join(" "),
          actionButton: buttonVariants({ variant: "default", size: "sm" }),
          cancelButton: buttonVariants({ variant: "outline", size: "sm" }),
          closeButton: [
            "absolute right-1.5 top-1.5 flex items-center justify-center size-5",
            "rounded-full border-2 border-outset border-border-strong",
            "bg-card shadow-sm cursor-pointer transition-all duration-200",
            "text-foreground",
            "group-data-[type=loading]:hidden",
          ].join(" "),
          success: "!bg-brand-accent-light dark:!bg-brand-accent-light",
          info: "!bg-blue-100 dark:!bg-blue-950/40",
          warning: "!bg-yellow-100 dark:!bg-yellow-950/40",
          error: "!bg-status-danger-bg dark:!bg-status-danger-bg",
          loading: "!bg-popover !w-fit !p-3 !min-h-0 !rounded-[14px] !gap-0",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
