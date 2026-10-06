import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CaretUpDownIcon,
  ChatTextIcon,
  CheckIcon,
  CubeIcon,
  FlaskIcon,
  GearIcon,
  GitForkIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlugIcon,
  SealCheckIcon,
  ShieldIcon,
  StackIcon,
  TerminalWindowIcon,
  TreeStructureIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
  RetroBadge,
  RetroButton,
  RetroCode,
  RetroLabel,
  RetroRule,
  RetroSunken,
  RetroWindow,
  useCopy,
} from "@/components/ui/retro-prototype";

const ACCOUNT = "alice.near";
const ROOT_ADDRESS = "bos://dev.everything.near/everything.dev";
const NODE_ADDRESS = "bos://alice.near/alice.dev";

const PROMPT = `Read https://everything.dev/skill.md and create an everything.dev node for ${ACCOUNT}. Extend ${ROOT_ADDRESS}, then publish it.`;
const COMMAND = `bos init --extends ${ROOT_ADDRESS} --account ${ACCOUNT}`;

const LINEAGE = [
  { title: "everything.dev", address: ROOT_ADDRESS, role: "Root node" },
  { title: "alice.dev", address: NODE_ADDRESS, role: "This node" },
];

const SURFACES = [
  {
    name: "UI",
    source: "Own",
    detail: "cdn.everything.dev/alice.near/ui@4f2a91c",
    integrity: "sha384-Qm9vZ…x2Pk",
    own: true,
  },
  { name: "API", source: "everything.dev", detail: "Inherited", integrity: "sha384-8aLd…0rQe" },
  { name: "Auth", source: "everything.dev", detail: "Inherited", integrity: "sha384-Hs1m…Yw7c" },
  { name: "Host", source: "everything.dev", detail: "Inherited", integrity: "sha384-p0Tq…L3fA" },
];

const CHILDREN = [
  {
    address: `${NODE_ADDRESS}/plugins/auth`,
    label: "…/plugins/auth",
    kind: "embedded",
    note: "from everything.dev",
    icon: <PlugIcon />,
  },
  {
    address: `${NODE_ADDRESS}/plugins/registry`,
    label: "…/plugins/registry",
    kind: "embedded",
    note: "from everything.dev",
    icon: <PlugIcon />,
  },
  {
    address: "bos://bob.near/bob.alice.dev",
    label: "bob.alice.dev",
    kind: "child node",
    note: "extends alice.dev",
    icon: <GitForkIcon />,
  },
];

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <RetroButton
      variant="ghost"
      size="lg"
      pressed={active}
      onClick={onClick}
      className="w-full justify-start"
    >
      {icon}
      {label}
    </RetroButton>
  );
}

function NodeSwitcher({ compact }: { compact?: boolean }) {
  return (
    <RetroButton
      variant="secondary"
      size={compact ? "lg" : "xl"}
      className="w-full min-w-0 justify-start"
      data-testid="sidebar-node-switcher"
    >
      <span className="flex size-8 shrink-0 items-center justify-center bg-brand font-semibold text-brand-foreground">
        A
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start text-left leading-tight">
        <span className="truncate text-base">alice.dev</span>
        {!compact && (
          <span className="truncate text-xs text-muted-foreground">{ACCOUNT} · owner</span>
        )}
      </span>
      <CaretUpDownIcon />
    </RetroButton>
  );
}

function TeamSwitcher() {
  return (
    <RetroButton
      variant="outline"
      size="sm"
      className="w-full justify-start"
      data-testid="sidebar-team-switcher"
    >
      <UsersIcon />
      <span className="flex-1 text-left">Team · Core</span>
      <CaretUpDownIcon />
    </RetroButton>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <NodeSwitcher />
        <TeamSwitcher />
      </div>
      <nav className="flex flex-col gap-1" aria-label="Main">
        <NavItem icon={<CubeIcon />} label="My node" active onClick={onNavigate} />
        <NavItem icon={<MagnifyingGlassIcon />} label="Registry" onClick={onNavigate} />
      </nav>
      <RetroRule className="flex-none" />
      <nav className="flex flex-col gap-1" aria-label="Example">
        <span className="px-3 pb-1 text-xs font-medium text-muted-foreground">Example</span>
        <NavItem icon={<FlaskIcon />} label="Things" onClick={onNavigate} />
      </nav>
      <nav className="mt-auto flex flex-col gap-1" aria-label="Footer">
        <NavItem icon={<GearIcon />} label="Settings" onClick={onNavigate} />
        <NavItem icon={<BookOpenIcon />} label="Docs" onClick={onNavigate} />
        <NavItem icon={<ShieldIcon />} label="Admin" onClick={onNavigate} />
      </nav>
    </div>
  );
}

function PageTitle({ actions }: { actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-3">
        <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">My node</h1>
        <p className="text-base text-muted-foreground">
          alice.dev · owned by <span className="font-mono text-foreground">{ACCOUNT}</span>
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

function NodeDetail() {
  return (
    <>
      <PageTitle
        actions={
          <RetroButton size="lg">
            Visit alice.dev
            <ArrowUpRightIcon />
          </RetroButton>
        }
      />
      <div className="flex flex-col gap-2">
        <RetroLabel>Address</RetroLabel>
        <RetroCode>{NODE_ADDRESS}</RetroCode>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <RetroWindow title="Lineage" icon={<TreeStructureIcon />}>
          <ol className="flex flex-col">
            {LINEAGE.map((node, index) => (
              <li key={node.address} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className="flex size-9 shrink-0 items-center justify-center bg-face bevel-raised">
                    <CubeIcon className="size-4" />
                  </span>
                  {index < LINEAGE.length - 1 && <span className="w-0.5 flex-1 bg-border" />}
                </div>
                <div className="flex min-w-0 flex-col gap-1 pb-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{node.title}</span>
                    <RetroBadge variant={index === LINEAGE.length - 1 ? "brand" : "neutral"}>
                      {node.role}
                    </RetroBadge>
                  </div>
                  <span className="font-mono text-xs break-all text-muted-foreground">
                    {node.address}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <RetroButton variant="outline" className="self-start">
            <GitForkIcon />
            Extend this node
          </RetroButton>
        </RetroWindow>

        <RetroWindow title="Surfaces" icon={<StackIcon />}>
          <RetroSunken variant="list">
            {SURFACES.map((surface) => (
              <div key={surface.name} className="flex items-center gap-3 px-4 py-3">
                <span className="w-12 shrink-0 font-medium text-foreground">{surface.name}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm text-foreground">
                    {surface.own ? surface.detail : `From ${surface.source}`}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {surface.integrity}
                  </span>
                </div>
                {surface.own ? (
                  <RetroBadge variant="success">
                    <SealCheckIcon />
                    Pinned
                  </RetroBadge>
                ) : (
                  <RetroBadge>Inherited</RetroBadge>
                )}
              </div>
            ))}
          </RetroSunken>
          <RetroButton variant="outline" className="self-start">
            Swap UI
          </RetroButton>
        </RetroWindow>
      </div>

      <RetroWindow title="Child nodes" icon={<GitForkIcon />}>
        <RetroSunken variant="list">
          {CHILDREN.map((child) => (
            <div
              key={child.address}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <span className="text-muted-foreground">{child.icon}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-sm text-foreground">{child.label}</span>
                <span className="text-xs text-muted-foreground">{child.note}</span>
              </div>
              <RetroBadge variant={child.kind === "embedded" ? "info" : "brand"}>
                {child.kind}
              </RetroBadge>
              <RetroButton variant="ghost" size="sm">
                Open
              </RetroButton>
            </div>
          ))}
        </RetroSunken>
      </RetroWindow>
    </>
  );
}

function EmptyNode() {
  const prompt = useCopy();
  const command = useCopy();
  return (
    <>
      <PageTitle />
      <RetroWindow className="w-full max-w-2xl" title="Create your node" icon={<CubeIcon />}>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold text-foreground">You don't have a node yet</h2>
          <p className="text-base text-muted-foreground">
            Hand the prompt to an agent, or run the command yourself.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <RetroButton
            size="xl"
            className="w-full"
            onClick={() => prompt.copy(PROMPT)}
            data-testid="node-empty-copy-prompt"
          >
            {prompt.copied ? <CheckIcon /> : <ChatTextIcon />}
            {prompt.copied ? "Copied" : "Copy prompt"}
          </RetroButton>
          <RetroButton
            size="xl"
            variant="outline"
            className="w-full"
            onClick={() => command.copy(COMMAND)}
            data-testid="node-empty-copy-command"
          >
            {command.copied ? <CheckIcon /> : <TerminalWindowIcon />}
            {command.copied ? "Copied" : "Copy command"}
          </RetroButton>
        </div>
        <div className="flex flex-col gap-2">
          <RetroLabel>Prompt</RetroLabel>
          <RetroCode>{PROMPT}</RetroCode>
        </div>
        <div className="flex flex-col gap-2">
          <RetroLabel>Command</RetroLabel>
          <RetroCode>{COMMAND}</RetroCode>
        </div>
      </RetroWindow>
    </>
  );
}

export function MyNodeScreen({ empty }: { empty: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh bg-background" data-testid="proto-my-node">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-border bg-sidebar p-4 md:flex">
        <SidebarBody />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background p-3 md:hidden">
          <div className="min-w-0 flex-1">
            <NodeSwitcher compact />
          </div>
          <RetroButton
            variant="outline"
            size="icon"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <ListIcon />
          </RetroButton>
        </header>

        <main className="flex min-w-0 flex-1 flex-col px-4 pt-8 pb-32 sm:px-8 sm:pt-12 lg:px-12">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
            {empty ? <EmptyNode /> : <NodeDetail />}
          </div>
        </main>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 flex bg-black/40 md:hidden">
          <RetroWindow
            className="h-full w-80 max-w-full"
            bodyClassName="flex-1 overflow-y-auto"
            title="alice.dev"
            icon={<CubeIcon />}
            onClose={() => setMenuOpen(false)}
          >
            <SidebarBody onNavigate={() => setMenuOpen(false)} />
          </RetroWindow>
          <button
            type="button"
            aria-label="Close menu"
            className="flex-1"
            onClick={() => setMenuOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
