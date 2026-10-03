import path from "node:path";

export default {
  plugins: {
    "@tailwindcss/postcss": { base: path.resolve(import.meta.dirname, "ui") },
  },
};
