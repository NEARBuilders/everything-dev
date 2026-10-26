import { spawn } from "node:child_process";
import { createServer } from "node:http";

// usage: node fake-service.mjs <port> [--ignore-term]
// Binds 127.0.0.1:<port> (readiness path any GET → 200) and spawns a
// "watcher" grandchild (sleep) that inherits this process's process group —
// the minimal real shape the process-death contract exercises: group-leader
// child + grandchild, both of which must die on group-targeted teardown.
const port = Number(process.argv[2] || process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: node fake-service.mjs <port> [--ignore-term]");
  process.exit(1);
}

if (process.argv.includes("--ignore-term")) {
  process.on("SIGTERM", () => {});
}

spawn("sleep", ["300"], { stdio: "ignore" });

const server = createServer((_req, res) => {
  res.statusCode = 200;
  res.end("ok");
});
server.listen(port, "127.0.0.1", () => {
  console.log(`fake-service ready on ${port}`);
});
