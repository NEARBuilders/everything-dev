import type { RetroIntensity } from "@/components/ui/retro-prototype";

export const RETRO_VARIANTS = [
  {
    key: "A",
    name: "Soft frames",
    intensity: "soft",
    notes: [
      "1px hairline bevel plus a 1px outline",
      "Flat muted title strip, no window controls",
      "Ring focus outline; press inverts the 1px bevel",
      "Window body is the card surface",
    ],
  },
  {
    key: "B",
    name: "Classic 98",
    intensity: "classic",
    notes: [
      "2px four-tone Win98 bevel (light, mid, shade, dark)",
      "Info-to-brand gradient title bar with window controls",
      "Dotted inner focus; label shifts 1px on press",
      "Grey face window body, white sunken fields, dithered toggles",
    ],
  },
  {
    key: "C",
    name: "Tycoon",
    intensity: "tycoon",
    notes: [
      "3px chunky bevel, 2px dark outline, hard drop shadow",
      "Brand title bar, heading-weight labels",
      "Whole button drops into its shadow on press",
      "Grey face window body, thicker frame inset",
    ],
  },
] as const satisfies readonly {
  key: string;
  name: string;
  intensity: RetroIntensity;
  notes: readonly string[];
}[];

export type RetroVariantKey = (typeof RETRO_VARIANTS)[number]["key"];

export const RETRO_SCREENS = [
  { key: "gallery", name: "Gallery" },
  { key: "landing", name: "Landing" },
  { key: "login", name: "Login" },
  { key: "node", name: "My node" },
  { key: "node-empty", name: "Empty node" },
] as const;

export type RetroScreenKey = (typeof RETRO_SCREENS)[number]["key"];
