---
"ui": minor
---

Redesign `Badge` so its variants read as status chips instead of mimicking `Button`'s solid dark fill: `default` is now a soft secondary chip, `secondary` a muted chip, `destructive` a soft danger tint (`border-destructive/40 bg-destructive/10 text-destructive`), and `outline` stays on `bg-card`. Adds `success` and `warning` status variants on the same soft-tint recipe. All variants keep the hard `border-outset` bevel. `Button` hover now dims the background color (`hover:bg-foreground/90`, `hover:bg-secondary/90`, `hover:bg-destructive/90`) instead of the whole element, keeping label text at full opacity.
