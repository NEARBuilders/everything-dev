import path from "node:path";
import { pathToFileURL } from "node:url";
const entry = path.resolve(process.cwd(), "../remote-landing/src/tree.tsx");
const mod = await import(pathToFileURL(entry).href);
const s = mod.tree.children[0].options.component.toString();
console.log("remote from host cwd → automatic:", s.includes("jsx(") || s.includes("jsxs("));
