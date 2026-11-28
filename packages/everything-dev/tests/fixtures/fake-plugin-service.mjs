import { createServer } from "node:http";

// usage: node fake-plugin-service.mjs <port>
// Like fake-service.mjs but reports its own PID at /pid — the dev-adopt
// replacement test reads it to observe that the session replaced the child.
const port = Number(process.argv[2] || process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: node fake-plugin-service.mjs <port>");
  process.exit(1);
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/pid")) {
    res.statusCode = 200;
    res.end(String(process.pid));
    return;
  }
  res.statusCode = 200;
  res.end("ok");
});
server.listen(port, "127.0.0.1", () => {
  console.log(`fake-plugin-service ready on ${port}`);
});
