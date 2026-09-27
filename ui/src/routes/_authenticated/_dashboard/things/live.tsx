import { createFileRoute } from "@tanstack/react-router";
import { pageTitle } from "@/lib/page-title";
import { ThingsLiveStreamPage } from "./-live-stream";

export const Route = createFileRoute("/_authenticated/_dashboard/things/live")({
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Live Stream · Things", match.context.runtimeConfig) },
      { name: "description", content: "Real-time Thing creation and deletion events." },
    ],
  }),
  component: ThingsLiveStreamPage,
});
