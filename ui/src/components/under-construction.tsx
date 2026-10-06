import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type { ClientRuntimeConfig } from "everything-dev/types";
import { getRepository } from "@/app";
import underConstructionImage from "@/assets/under-construction.gif";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface UnderConstructionProps {
  sourceFile?: string;
  url?: string;
  tooltip?: string;
  className?: string;
  runtimeConfig?: Partial<ClientRuntimeConfig>;
}

export function UnderConstruction({
  sourceFile,
  url,
  tooltip,
  className,
  runtimeConfig,
}: UnderConstructionProps) {
  const repository = getRepository(runtimeConfig);
  const outlink =
    url ??
    (repository ? (sourceFile ? `${repository}/blob/main/${sourceFile}` : repository) : undefined);

  const image = (
    <img
      src={underConstructionImage}
      alt="Under construction"
      width={459}
      height={28}
      className="block h-auto w-full"
    />
  );

  if (!outlink) {
    return (
      <div className={cn("w-full max-w-md", className)} data-testid="under-construction">
        {image}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              href={outlink}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Under construction - view source"
              data-testid="under-construction"
              className={cn("block w-full max-w-md", className)}
            >
              {image}
            </a>
          }
        />
        <TooltipContent side="top" sideOffset={8}>
          <span className="flex items-center gap-1.5">
            {tooltip ?? "See the code and contribute"}
            <ArrowSquareOutIcon className="size-3" />
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
