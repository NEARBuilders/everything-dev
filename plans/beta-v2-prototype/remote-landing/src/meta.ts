export const plugin = {
  name: "landing",
  mount: "public" as const,
  routes: ["/", "/about"] as const,
  nav: [{ label: "Home", to: "/" }, { label: "About", to: "/about" }] as const,
};

export default plugin;