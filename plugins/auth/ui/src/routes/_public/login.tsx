import { createFileRoute, Outlet } from "@tanstack/react-router";
import "../../styles.css";

export const Route = createFileRoute("/_public/login")({
  ssr: false,
  component: LoginLayout,
});

function LoginLayout() {
  return <Outlet />;
}
