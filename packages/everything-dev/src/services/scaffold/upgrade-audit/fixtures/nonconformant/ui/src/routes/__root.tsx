import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head>
        <title>Thick Root</title>
      </head>
      <body>
        <Outlet />
      </body>
    </html>
  ),
});
