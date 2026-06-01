import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, ExternalLink, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type SearchParams = {
  path?: string;
};

export const Route = createFileRoute("/_layout/")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    path: typeof search.path === "string" && search.path.length > 0 ? search.path : undefined,
  }),
  component: HomeViewerPage,
});

function HomeViewerPage() {
  const { path } = Route.useSearch();
  const iframeSrc = path ? `./_viewer?path=${encodeURIComponent(path)}` : "./_viewer";

  return (
    <div className="relative h-full w-full bg-background">
      <iframe
        title="BOS viewer"
        src={iframeSrc}
        loading="eager"
        allow="clipboard-read; clipboard-write"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        className="block h-full w-full border-0 bg-background"
      />
      <FloatingSkillAssistant />
    </div>
  );
}

function FloatingSkillAssistant() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const issueUrl = "https://github.com/NEARBuilders/everything-dev/issues/new";

  const handleCopy = async () => {
    const rawSkillUrl = "/skill.md";
    await navigator.clipboard.writeText(rawSkillUrl);
    setCopied(true);
    toast.success("Skill URL copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="pointer-events-auto w-[min(22rem,calc(100vw-2rem))] rounded-[24px] border border-border bg-card/95 p-4 shadow-2xl backdrop-blur"
          >
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles size={16} />
              Assistant
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button asChild className="justify-start">
                <Link to="/skill" preload="intent" onClick={() => setOpen(false)}>
                  <Sparkles size={14} />
                  Open skill
                </Link>
              </Button>
              <Button variant="outline" asChild className="justify-start">
                <a href={issueUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                  Report issue
                </a>
              </Button>
              <Button variant="outline" asChild className="justify-start">
                <Link to="/about" preload="intent" onClick={() => setOpen(false)}>
                  <ExternalLink size={14} />
                  About
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" onClick={handleCopy}>
                <Copy size={14} />
                {copied ? "Copied URL" : "Copy skill URL"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        animate={
          open
            ? { y: 0, scale: 1.02 }
            : {
                y: [0, -34, 0, -15, 0, -6, 0],
                scale: [1, 1.02, 0.97, 1.01, 0.992, 1, 1],
              }
        }
        transition={
          open
            ? { duration: 0.25, ease: "easeOut" }
            : {
                duration: 2.8,
                ease: [0.22, 1, 0.36, 1],
                repeat: Number.POSITIVE_INFINITY,
                times: [0, 0.18, 0.34, 0.5, 0.66, 0.8, 1],
              }
        }
        whileTap={{ scale: 0.97 }}
        aria-expanded={open}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className="pointer-events-auto relative h-24 w-24 cursor-pointer rounded-full border border-white/10 bg-black text-white shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
      >
        <span className="absolute inset-[10%] rounded-full bg-[radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.24),rgba(255,255,255,0.05)_28%,transparent_44%)]" />
        <span className="absolute inset-[18%] rounded-full border border-white/6" />
      </motion.button>
    </div>
  );
}
