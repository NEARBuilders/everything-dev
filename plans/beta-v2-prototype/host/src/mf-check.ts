import { createInstance } from "@module-federation/enhanced/runtime";

async function main() {
  const mf = createInstance({
    name: "host",
    remotes: [
      { name: "remote_landing", entry: "http://localhost:3101/remoteEntry.js" },
      { name: "remote_dashboard", entry: "http://localhost:3102/remoteEntry.js" },
      { name: "remote_settings", entry: "http://localhost:3103/remoteEntry.js" },
      { name: "remote_filebased", entry: "http://localhost:3104/remoteEntry.js" },
    ],
  });

  const names = ["remote_landing", "remote_dashboard", "remote_settings", "remote_filebased"];
  for (const name of names) {
    console.log(`\n=== loading ${name}/tree over MF ===`);
    const mod = (await mf.loadRemote<any>(`${name}/tree`)) ?? {};
    const module = mod.default && mod.default.tree ? mod.default : mod;
    console.log("module exports:", Object.keys(module));
    console.log("has tree:", module.tree !== undefined);
    const children = (module.tree?.children ?? []) as Array<{ options?: { id?: string } }>;
    console.log(
      "tree children ids:",
      children.map((c) => c.options?.id).join(", "),
    );
  }
}

main().then(
  () => {
    console.log("\nMF LOAD PASS");
    process.exit(0);
  },
  (err) => {
    console.error("\nMF LOAD FAIL:", err);
    process.exit(1);
  },
);
