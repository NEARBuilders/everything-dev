import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/blog/$postId")({
  component: PostPage,
});

function PostPage() {
  const { postId } = Route.useParams();
  return (
    <div>
      <h1>Blog post: {postId}</h1>
      <p>Dynamic route from remote-filebased · grafted under host `public` mount</p>
      <a href="/blog">← Blog</a>
    </div>
  );
}