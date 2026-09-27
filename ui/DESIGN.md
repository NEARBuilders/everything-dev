# CityNode design system

The CityNode UI is built on shadcn's `base-maia` style (preset `b3ZN5L2h44`) running on
Base UI, with our own tokens, sizes and page patterns layered on top. The preset is
the starting point; this file is the source of truth.

`bun lint` enforces the mechanical parts through `@shadcn/lint`. The rest is judgment —
read this before building or changing a page.

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
| Display (landing hero) | `text-5xl sm:text-6xl font-semibold` |
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
- Radius comes from the scale (`rounded-lg` … `rounded-4xl`); buttons and inputs are
  pill-shaped by default (maia) — don't override.

## Components

Use `ui/src/components/ui/*` as-is. Change appearance through variants and sizes;
`className` on a design-system component is for **layout only** (margin, width,
flex/grid placement). `@shadcn/lint`'s `no-restyle` enforces this. Two allowances:
containers (`Card*`, `TabsContent`, dialog/sheet header/footer, `SidebarGroup`) also
take spacing; `Input`, `Textarea` and `Badge` take `font-mono` for identifiers, hashes
and JSON.

| Component | Sizes | Notes |
|---|---|---|
| Button | `sm` 36px · `default` 44px · `lg` 48px · `icon*` | One `default`-variant button per view; everything else `outline`, `secondary` or `ghost`. Links rendered as buttons use `render={<Link />}` + `nativeButton={false}`. |
| Input / Select / Textarea | `default` 44px | Label above, one line of helper text below via `Field`. |
| Badge | `default`, `secondary`, `outline`, `success`, `warning`, `destructive` | Status only — never as decoration. |
| Card | — | Only for openable / actionable items and grouped forms. |

## Page patterns

- **Page:** `PageContainer` → `PageHeader` (title, one-line description, primary action)
  → sections.
- **Section:** `SectionHeader` (title + optional action) → content.
- **Empty state:** icon, one-line title, one sentence, one action.
- **Step flow:** multi-step tasks (apply, create tenant) show steps as a numbered list;
  completed steps collapse to a single checked row.
- **Destructive actions:** live at the bottom of a page in a "Danger zone" section and
  always confirm through `ConfirmDialog`.

## Glossary (use exactly)

Home (`/dashboard`) · Explore (`/explore`) · Directory (`/discover`) · My community
(`/dashboard/node`) · Events & profile (`/nodes/$id/content`) · Proposals · Community
settings (`/tenant/$id`) · Organizations · Stake · Start a community (`/apply`) · Settings.

## Test ids

Keep every existing `data-testid`. New UI chrome gets `data-testid="<area>-<purpose>"`
(see AGENTS.md). Browser specs select by test id, not by copy — so copy can change freely.
