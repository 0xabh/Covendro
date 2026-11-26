import process from "node:process";

import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const browserBuild = process.env.COVENDRO_BROWSER_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: browserBuild ? ".next-browser" : ".next",
  typescript: { tsconfigPath: browserBuild ? "tsconfig.browser.json" : "tsconfig.json" },
  outputFileTracingRoot: repositoryRoot,
};

export default nextConfig;
