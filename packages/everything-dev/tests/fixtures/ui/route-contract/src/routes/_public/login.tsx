const validateSearch = (search: Record<string, unknown>) => ({
  redirect: typeof search.redirect === "string" ? search.redirect : "/",
});
const loaderDeps = ({ search }: { search: { redirect: string } }) => ({
  redirect: search.redirect,
});
const searchMiddleware = ({ search, next }: { search: unknown; next: (s: unknown) => unknown }) =>
  next(search);
const context = () => ({ fromContext: true });
const params = { parse: (raw: Record<string, string>) => raw };

export const Route = {
  options: {
    ssr: false,
    validateSearch,
    loaderDeps,
    search: { middlewares: [searchMiddleware] },
    context,
    params,
    staleTime: 1000,
    gcTime: 2000,
    preloadStaleTime: 3000,
    pendingMs: 100,
    pendingMinMs: 200,
    shouldReload: false,
  },
};
