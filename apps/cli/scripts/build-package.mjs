import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(cliRoot, "..", "..");
const dist = join(cliRoot, "dist");
const runtime = join(dist, "runtime");
const webDist = join(repoRoot, "apps", "web", "dist");
const providers = join(repoRoot, "packages", "core", "src", "providers", "providers.json");
const devtoolsStub = join(cliRoot, "scripts", "react-devtools-stub.mjs");

if (!existsSync(join(webDist, "index.html"))) {
  throw new Error("apps/web/dist is missing; run pnpm --filter @personacode/web build first");
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "eof",
  define: { "process.env.DEV": '"false"' },
  plugins: [{
    name: "optional-react-devtools",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: devtoolsStub }));
    },
  }],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: "info",
};

await build({
  ...shared,
  entryPoints: [join(cliRoot, "src", "index.tsx")],
  outfile: join(dist, "index.js"),
});

await build({
  ...shared,
  entryPoints: [join(repoRoot, "apps", "server", "src", "index.ts")],
  outfile: join(runtime, "server.js"),
});

cpSync(webDist, join(runtime, "web"), { recursive: true });
cpSync(providers, join(dist, "providers.json"));
cpSync(providers, join(runtime, "providers.json"));
cpSync(join(repoRoot, "LICENSE"), join(dist, "LICENSE"));

writeFileSync(
  join(dist, "package.json"),
  JSON.stringify(
    {
      name: "personacode",
      version: "0.1.0",
      description: "Privacy-first multi-provider AI agent CLI and self-hosted web app",
      type: "module",
      license: "MIT",
      engines: { node: ">=22" },
      bin: { pcode: "./index.js", personacode: "./index.js" },
      files: ["index.js", "runtime", "providers.json", "LICENSE"],
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
