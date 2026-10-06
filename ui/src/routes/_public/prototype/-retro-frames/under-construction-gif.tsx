import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import underConstructionImage from "@/assets/under-construction.gif";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function UnderConstructionGif({ repository }: { repository?: string }) {
  const image = (
    <img
      src={underConstructionImage}
      alt="Under construction"
      width={459}
      height={28}
      className="block h-auto w-full max-w-md"
    />
  );

  if (!repository) return image;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              href={repository}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Under construction - view source"
              data-testid="landing-under-construction"
              className="block w-full max-w-md"
            >
              {image}
            </a>
          }
        />
        <TooltipContent side="top" sideOffset={8}>
          <span className="flex items-center gap-1.5">
            See the code and contribute
            <ArrowSquareOutIcon className="size-3" />
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
