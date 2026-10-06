import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  CubeIcon,
  GitForkIcon,
  NotePencilIcon,
  PlusIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
  RetroBadge,
  RetroButton,
  type RetroButtonProps,
  RetroCode,
  RetroDialog,
  RetroInput,
  RetroLabel,
  RetroTextarea,
  RetroWindow,
} from "@/components/ui/retro-prototype";
import {
  RETRO_SCREENS,
  RETRO_VARIANTS,
  type RetroScreenKey,
  type RetroVariantKey,
} from "./variants";

const BUTTON_VARIANTS = [
  "default",
  "brand",
  "outline",
  "secondary",
  "ghost",
  "destructive",
] as const;
const BUTTON_SIZES = ["sm", "default", "lg", "xl"] as const;

type ButtonVariant = NonNullable<RetroButtonProps["variant"]>;

function ButtonRow({ variant }: { variant: ButtonVariant }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-xs text-muted-foreground">{variant}</span>
      <div className="flex flex-wrap items-center gap-4">
        {BUTTON_SIZES.map((size) => (
          <RetroButton key={size} variant={variant} size={size}>
            {size === "default" ? "Default" : size}
          </RetroButton>
        ))}
        <RetroButton variant={variant} pressed>
          Pressed
        </RetroButton>
        <RetroButton variant={variant} disabled>
          Disabled
        </RetroButton>
        <RetroButton variant={variant} size="icon" aria-label="Add">
          <PlusIcon />
        </RetroButton>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function GalleryScreen({
  variant,
  onScreen,
}: {
  variant: RetroVariantKey;
  onScreen: (screen: RetroScreenKey) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toggle, setToggle] = useState(true);
  const active = RETRO_VARIANTS.find((item) => item.key === variant) ?? RETRO_VARIANTS[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pt-10 pb-32 sm:px-8 sm:pt-16">
      <header className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-sm text-muted-foreground">prototype/retro-frames</span>
          <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">Retro frames</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            What should bevel buttons, window frames and sunken panels look like on everything.dev?
            Flip variants with the bar below or the arrow keys.
          </p>
        </div>
        <RetroWindow title={`Variant ${active.key} · ${active.name}`} icon={<CubeIcon />}>
          <ul className="grid gap-2 text-sm text-foreground sm:grid-cols-2">
            {active.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="text-muted-foreground">·</span>
                {note}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {RETRO_SCREENS.filter((screen) => screen.key !== "gallery").map((screen) => (
              <RetroButton key={screen.key} variant="outline" onClick={() => onScreen(screen.key)}>
                {screen.name}
                <ArrowRightIcon />
              </RetroButton>
            ))}
          </div>
        </RetroWindow>
      </header>

      <Section title="Buttons">
        <div className="flex flex-col gap-8">
          {BUTTON_VARIANTS.map((item) => (
            <ButtonRow key={item} variant={item} />
          ))}
          <div className="flex flex-col gap-3">
            <span className="font-mono text-xs text-muted-foreground">toggle (click me)</span>
            <div className="flex flex-wrap gap-4">
              <RetroButton
                variant="outline"
                pressed={toggle}
                onClick={() => setToggle((value) => !value)}
              >
                {toggle ? "On" : "Off"}
              </RetroButton>
              <RetroButton
                variant="ghost"
                pressed={toggle}
                onClick={() => setToggle((value) => !value)}
              >
                Ghost {toggle ? "on" : "off"}
              </RetroButton>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Frames">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <RetroWindow title="alice.dev" icon={<CubeIcon />}>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-sm break-all text-muted-foreground">
                bos://alice.near/alice.dev
              </span>
              <div className="flex flex-wrap gap-2">
                <RetroBadge variant="brand">Own UI</RetroBadge>
                <RetroBadge variant="success">
                  <SealCheckIcon />
                  Pinned
                </RetroBadge>
                <RetroBadge>Extends everything.dev</RetroBadge>
              </div>
            </div>
            <p className="text-base text-muted-foreground">
              A node card: the thing you open, extend or compose.
            </p>
            <div className="flex flex-wrap gap-3">
              <RetroButton>Open</RetroButton>
              <RetroButton variant="outline">
                <GitForkIcon />
                Extend this node
              </RetroButton>
            </div>
          </RetroWindow>

          <RetroWindow title="Rename node" icon={<NotePencilIcon />} onClose={() => undefined}>
            <div className="flex flex-col gap-2">
              <RetroLabel htmlFor="proto-node-title">Title</RetroLabel>
              <RetroInput id="proto-node-title" defaultValue="alice.dev" />
              <p className="text-sm text-muted-foreground">
                Shown in the node switcher and registry.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <RetroLabel htmlFor="proto-node-description">Description</RetroLabel>
              <RetroTextarea
                id="proto-node-description"
                placeholder="One sentence about this node"
              />
            </div>
            <div className="flex flex-col gap-2">
              <RetroLabel>Config</RetroLabel>
              <RetroCode>{`{\n  "extends": "bos://dev.everything.near/everything.dev",\n  "account": "alice.near"\n}`}</RetroCode>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <RetroButton variant="outline">Cancel</RetroButton>
              <RetroButton>Save</RetroButton>
            </div>
          </RetroWindow>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <RetroDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title="Swap UI"
            icon={<ArrowsClockwiseIcon />}
            trigger={<RetroButton size="lg">Open dialog</RetroButton>}
          >
            <p className="text-base text-muted-foreground">
              alice.dev keeps its API, auth and plugins. Only the UI bundle changes.
            </p>
            <RetroCode>cdn.everything.dev/alice.near/ui@9b0e14d</RetroCode>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <RetroButton variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </RetroButton>
              <RetroButton onClick={() => setDialogOpen(false)}>Swap UI</RetroButton>
            </div>
          </RetroDialog>
          <span className="text-sm text-muted-foreground">
            Centred window on desktop, bottom sheet under 640px.
          </span>
        </div>
      </Section>
    </div>
  );
}
