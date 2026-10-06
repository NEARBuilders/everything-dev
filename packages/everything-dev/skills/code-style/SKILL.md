---
name: code-style
description: Code style conventions for everything-dev projects — component file naming (kebab-case, lowercase), CSS (semantic Tailwind only, no hardcoded colors), no comments in implementation, import/export conventions, and following neighboring file patterns.
metadata:
  sources: "AGENTS.md,ui/src/components/ui/,packages/everything-dev/src/cli/init.ts"
---

# Code Style

## Component & File Naming

- **Files**: lowercase, kebab-case (`my-button.tsx`, `user-profile.tsx`, `data-table.tsx`)
- **Directories**: lowercase, kebab-case (`route-helpers/`, `api-client/`, `plugin-sidebar/`)
- **Never PascalCase** for file or directory names
- **Component exports**: named exports matching the file name converted to PascalCase (`user-profile.tsx` → `export function UserProfile()`)

### Examples

```
✅ ui/src/components/ui/data-table.tsx
✅ ui/src/components/ui/dropdown-menu.tsx
✅ ui/src/routes/_layout/settings.tsx

❌ ui/src/components/ui/DataTable.tsx
❌ ui/src/components/ui/DropdownMenu.tsx
❌ ui/src/routes/_layout/SettingsPage.tsx
```

- Route files under `ui/src/routes/` follow TanStack Router conventions: `_` prefix for layouts, kebab-case for path segments

## CSS & Tailwind

- **Use semantic theme tokens only**: `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`
- **No hardcoded colors**: `bg-blue-600`, `text-white`, `border-gray-200`
- **No magic spacing values** outside of Tailwind's scale
- Dark mode is handled automatically by the theme system — do not add `dark:` variants

```tsx
<div className="bg-background text-foreground">         // ✅ correct
<div className="p-4 rounded-lg border border-border">   // ✅ correct
<div className="bg-blue-600 text-white">                 // ❌ wrong
```

## No Code Comments

- **No comments in implementation files** — types and tests are the documentation
- JSDoc on public API exports is acceptable but not required
- Inline comments (`//`, `/* */`) are not allowed in `src/` files

## Imports & Exports

- Use `@/` path aliases (`import { Button } from "@/components/ui/button"`)
- **Named exports** for components and utilities
- **Default exports** only for route components (`export const Route = createFileRoute(...)`)
- Shared components exported from `ui/src/components/index.ts`

## Follow Neighboring Files

- Match the import style, typing patterns, and structure of files in the same directory
- If neighboring files use `function Component()`, don't use `const Component: React.FC = () =>`
- If neighboring files group imports by type (React, third-party, local), do the same
- Consistent file structure within a directory is more important than personal preference

## The tasks you will actually be given

**"Review my new component for style."** Check four things: file is kebab-case with a PascalCase named export, classes use semantic tokens (`bg-background`, `text-muted-foreground`) not hardcoded colors, no inline comments, imports use `@/` aliases grouped like the neighbors.

**"Where does this shared component go?"** `ui/src/components/ui/<name>.tsx`, named export, added to `ui/src/components/index.ts`. Feature-specific components stay colocated with the route that uses them.

**"Is this file name ok?"** Lowercase kebab-case for every file and directory, including routes. PascalCase file names are the only hard violation; route path segments follow TanStack conventions (`_` prefix for layouts).
