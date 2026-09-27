import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type { ClientRuntimeConfig } from "everything-dev/types";
import { motion } from "framer-motion";
import { getRepository } from "@/app";
import underConstructionImage from "@/assets/under-construction.gif";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface UnderConstructionProps {
  label?: string;
  sourceFile?: string;
  url?: string;
  tooltip?: string;
  className?: string;
  onClick?: () => void;
  skipNavigation?: boolean;
  pressed?: boolean;
  runtimeConfig?: Partial<ClientRuntimeConfig>;
}

export function UnderConstruction({
  label,
  sourceFile,
  url,
  tooltip,
  className,
  onClick,
  skipNavigation,
  pressed,
  runtimeConfig,
}: UnderConstructionProps) {
  const resolveOutlink = () => {
    if (url) return url;
    const repository = getRepository(runtimeConfig);
    if (!repository) return undefined;
    return sourceFile ? `${repository}/blob/main/${sourceFile}` : repository;
  };
  const hasOutlink = Boolean(resolveOutlink());

  const handleClick = () => {
    onClick?.();
    const outlink = resolveOutlink();
    if (skipNavigation || !outlink) return;
    setTimeout(() => {
      window.open(outlink, "_blank", "noopener,noreferrer");
    }, 150);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          className={cn("block cursor-pointer", className)}
          style={{ perspective: 800 }}
          onClick={handleClick}
          data-pressed={pressed || undefined}
          aria-label={
            skipNavigation || !hasOutlink
              ? label
                ? `${label} under construction`
                : "under construction"
              : label
                ? `${label} under construction - view source`
                : "under construction - view source"
          }
        >
          <motion.span
            animate={
              pressed
                ? { scale: 0.95, rotateY: 0, z: -15 }
                : {
                    rotateY: [0, 12, 0, -12, 0],
                    y: [0, -4, 0],
                  }
            }
            transition={
              pressed
                ? { duration: 0.15 }
                : {
                    rotateY: { duration: 4, ease: "easeInOut", repeat: Infinity },
                    y: { duration: 3, ease: "easeInOut", repeat: Infinity },
                  }
            }
            whileTap={{ scale: 0.95, rotateY: 0, z: -15 }}
            className="block"
            style={{ transformStyle: "preserve-3d" }}
          >
            <img
              src={underConstructionImage}
              alt={label ? `${label} under construction` : "under construction"}
              className="w-full h-auto rounded-xl border border-border object-cover shadow-lg"
            />
          </motion.span>
        </TooltipTrigger>
        {!skipNavigation && hasOutlink && (
          <TooltipContent side="top" sideOffset={6}>
            <span className="flex items-center gap-1.5">
              {tooltip ?? "See the code and contribute"}
              <ArrowSquareOutIcon className="size-3" />
            </span>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
