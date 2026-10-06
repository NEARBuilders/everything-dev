# everything.dev design system

The everything.dev UI is built on shadcn's `base-lyra` style (square) running on Base UI,
with our own tokens, sizes, frames and page patterns layered on top. This file is the
source of truth.

`pnpm run lint` enforces the mechanical parts through `@shadcn/lint`. The rest is judgment —
read this before building or changing a page.

## Direction: soft frames

Modern space, type and layout, with the frame borrowed from Windows 95/98-era software
(RollerCoaster Tycoon): raised bevel buttons that press in, window title bars, sunken
panels for inputs and code. Settled on the `prototype/retro-frames` branch as variant A,
"Soft frames": a 1px bevel plus a 1px outline, nothing louder. No desktop metaphor — no
draggable windows, taskbar or desktop icons.

- Everything is square: `--radius` is `0`, so the whole `rounded-*` scale resolves to 0.
  `rounded-full` (avatars, dots) is the only round shape.
- Frames are tokens in `styles.css` (`--bevel-raised`, `--bevel-pressed`,
  `--bevel-sunken`, `--bevel-window`, built from `--bevel-light`/`--bevel-shade`, light
  and dark) and utilities used **only inside `components/ui/*`**: `bevel-raised`,
  `bevel-pressed`, `bevel-sunken`, `bevel-window`, `bevel-none`, `bg-titlebar`,
  `transition-bevel`. They compose with `ring-*`, so focus rings still work.
- Raised: buttons, toggles, active tabs. Pressed: `:active`, `aria-expanded`,
  `data-pressed`, the active sidebar item. Sunken: inputs, selects, textareas,
  checkboxes, tab lists, code panels. Window: cards, dialogs, sheets, popovers, menus.
- `--face` / `bg-face` is the neutral raised surface (outline buttons, disabled
  buttons). Disabled buttons sit on the face with embossed muted text, not opacity.
- `Window` + `WindowTitleBar` + `WindowBody` is the titled frame for grouped content and
  focused flows (login, node panels). `Card` is the untitled frame.
- Motion: the pressed bevel is the press feedback (no `scale`, no `translate`). Press is
  instant, release eases out in 120ms (`transition-bevel`), on named properties only.
  Tailwind's `hover:` is already gated to hover-capable pointers.
- Mobile first: windows go full-bleed with margins, dialogs become bottom sheets.
- `plugins/auth/ui` duplicates the primitives and the frame utilities; change both.

## Principles

1. **One job per screen.** Every page answers one question or completes one task. If a
   page needs a second primary action, it is two pages or a step flow.
2. **Say less.** A page title, at most one sentence of description, then the thing
   itself. Helper text is a single line under the field that needs it. No paragraphs
   that explain the UI.
3. **Space is structure.** Separate groups with whitespace before reaching for borders,
   cards or dividers. Cards are for things you can act on or open.
4. **Big, obvious targets.** Controls are 44px tall by default. The next step is always
   the most prominent thing on the screen.
5. **Name things once.** Use the names in the glossary below everywhere — nav, headings,
   breadcrumbs, buttons, toasts.
6. **Never strand the user.** Every empty, error and not-found state has a way forward.

## Tokens

Defined in `ui/src/styles.css` (oklch, light + dark). Use only semantic classes.

| Role | Classes |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-muted`, `bg-popover`, `bg-sidebar` |
| Text | `text-foreground`, `text-muted-foreground` |
| Primary action (ink) | `bg-primary text-primary-foreground` |
| Brand highlight (sparingly: active state, key figure, hero accent) | `bg-brand text-brand-foreground`, `text-brand-strong`, `bg-brand-muted` |
| Hover / selected tint | `bg-accent text-accent-foreground` |
| Status | `success`, `warning`, `info`, `destructive` — each with `-foreground`, `-muted`, `-muted-foreground` (`bg-success-muted text-success-muted-foreground`) |
| Lines | `border-border`, `border-input`, `ring-ring` |

Never use the Tailwind palette (`bg-blue-600`), hex values, or arbitrary values
(`p-[13px]`, `rounded-[12px]`). If something is missing, add a token here and in
`styles.css`, not a one-off.

Legacy aliases (`brand-accent*`, `status-*`, `link`) still resolve but are being removed —
use the new names.

## Type

Inter for text, Geist for headings (`font-heading`, applied to `h1`–`h4` automatically),
Geist Mono for code and identifiers.

| Use | Classes |
|---|---|
| Display (landing hero) | `text-4xl sm:text-5xl font-semibold` |
| Page title (`h1`) | `text-3xl sm:text-4xl font-semibold` |
| Section title (`h2`) | `text-xl font-semibold` |
| Card / group title (`h3`) | `text-lg font-medium` |
| Body | `text-base` (default) |
| Secondary / helper | `text-sm text-muted-foreground` |
| Label, meta, badge | `text-xs` / `text-sm font-medium` |

No uppercase micro-labels (`text-[11px] uppercase tracking-wider`). Use sentence case
everywhere.

## Spacing and layout

- Page container: `PageContainer` (`narrow` forms · `default` · `wide` dashboards).
- Vertical rhythm: `gap-12` between page sections, `gap-6` inside a section,
  `gap-3` inside a group. Prefer `flex flex-col gap-*` over `space-y-*`.
- Everything is square (lyra, `--radius: 0`). Don't add radius back with arbitrary
  values.

## Components

Use `ui/src/components/ui/*` as-is. Change appearance through variants and sizes;
`className` on a design-system component is for **layout only** (margin, width,
flex/grid placement). `@shadcn/lint`'s `no-restyle` enforces this. Two allowances:
containers (`Card*`, `TabsContent`, dialog/sheet header/footer, `SidebarGroup`) also
take spacing; `Input`, `Textarea` and `Badge` take `font-mono` for identifiers, hashes
and JSON.

| Component | Sizes | Notes |
|---|---|---|
| Button | `xs` 28px · `sm` 36px · `default` 44px · `lg` 48px · `xl` 56px · `icon*` | Raised bevel, presses in. One `default`-variant button per view; everything else `outline` (face), `secondary` (card), `ghost` (flat until hover) or `destructive` (tinted). `brand` is for the rare hero moment. Links rendered as buttons use `render={<Link />}` + `nativeButton={false}`. |
| Input / Select / Textarea | `default` 44px | Sunken on `bg-background`. Label above, one line of helper text below via `Field`. |
| Badge | `default`, `secondary`, `outline`, `success`, `warning`, `destructive` | Status only — never as decoration. |
| Card | — | Window frame, no title bar. Only for openable / actionable items and grouped forms. |
| Window | — | Window frame with a muted title strip (`WindowTitleBar`: icon, title, actions, close). For titled groups and focused flows. |

## Page patterns

- **Page:** `PageContainer` → `PageHeader` (title, one-line description, primary action)
  → sections.
- **Landing (`/`):** no app shell, signed in or not. Centered title (`text-4xl
  sm:text-5xl`), the under-construction GIF linking to the source, one `lg` button
  (Sign in / Open my node), then the public footer.
- **Section:** `SectionHeader` (title + optional action) → content.
- **Empty state:** icon, one-line title, one sentence, one action.
- **Step flow:** multi-step tasks (create organization, swap a node's UI) show steps as a numbered list;
  completed steps collapse to a single checked row.
- **Destructive actions:** live at the bottom of a page in a "Danger zone" section and
  always confirm through `ConfirmDialog`.

## Glossary (use exactly)

Nouns follow `GLOSSARY.md` (node, owner, extends, composition, surface, contract).
Navigation names:

My node (signed-in home) · Registry · Organizations (`/settings/organizations`) ·
Example (Things) · Settings · Docs (`/about`) · Skill (`/skill`) · Admin.

Say "node", never "runtime" or "tenant", in UI copy. A composed node is a "plugin" only
when describing its role inside another node.

## Test ids

Keep every existing `data-testid`. New UI chrome gets `data-testid="<area>-<purpose>"`
(see AGENTS.md). Browser specs select by test id, not by copy — so copy can change freely.
