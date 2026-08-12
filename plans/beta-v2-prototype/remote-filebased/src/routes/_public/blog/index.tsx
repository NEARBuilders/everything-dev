import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/blog/")({
  component: () => (
    <div>
      <h1>File-based blog index (/blog)</h1>
      <p>From remote-filebased · grafted under host `public` mount</p>
      <a href="/">← Home</a>
    </div>
  ),
});