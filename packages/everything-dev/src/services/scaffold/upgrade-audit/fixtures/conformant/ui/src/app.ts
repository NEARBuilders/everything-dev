export const appLocale = {
  locales: ["en"],
  defaultLocale: "en",
  cookieName: "app_locale",
};

export const apiConnectionError = () => ({
  title: "Connection problem",
  description: "We couldn't reach the API. Check your connection and try again.",
});
