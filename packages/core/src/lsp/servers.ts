import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

/**
 * Language-server registry. Maps a file to the LSP `languageId` it should be opened
 * with, and to the first language server we can find on PATH for that language.
 * Detection is PATH-based (portable across win32/posix) and cached per process.
 * Nothing is bundled — this is the plan's "start typescript-language-server / pyright
 * if found": if no server is installed for a language, that file is reported as
 * "no language server" rather than crashing.
 */

/** file extension → LSP languageId. */
const EXT_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
};

/** Which server family drives a languageId (several ids share one server). */
const LANGUAGE_GROUP: Record<string, string> = {
  typescript: "typescript",
  typescriptreact: "typescript",
  javascript: "typescript",
  javascriptreact: "typescript",
  python: "python",
  go: "go",
  rust: "rust",
  c: "clang",
  cpp: "clang",
  json: "vscode-json",
  css: "vscode-css",
  scss: "vscode-css",
  html: "vscode-html",
};

export interface ServerSpec {
  group: string;
  /** ordered launch candidates; first whose command is on PATH wins. */
  candidates: Array<{ command: string; args: string[] }>;
  installHint: string;
}

const SERVERS: Record<string, ServerSpec> = {
  typescript: {
    group: "typescript",
    candidates: [{ command: "typescript-language-server", args: ["--stdio"] }],
    installHint: "npm i -g typescript-language-server typescript",
  },
  python: {
    group: "python",
    candidates: [
      { command: "pyright-langserver", args: ["--stdio"] },
      { command: "pylsp", args: [] },
    ],
    installHint: "npm i -g pyright  (or: pipx install python-lsp-server)",
  },
  go: {
    group: "go",
    candidates: [{ command: "gopls", args: [] }],
    installHint: "go install golang.org/x/tools/gopls@latest",
  },
  rust: {
    group: "rust",
    candidates: [{ command: "rust-analyzer", args: [] }],
    installHint: "rustup component add rust-analyzer",
  },
  clang: {
    group: "clang",
    candidates: [{ command: "clangd", args: [] }],
    installHint: "install clangd (LLVM)",
  },
  "vscode-json": {
    group: "vscode-json",
    candidates: [{ command: "vscode-json-language-server", args: ["--stdio"] }],
    installHint: "npm i -g vscode-langservers-extracted",
  },
  "vscode-css": {
    group: "vscode-css",
    candidates: [{ command: "vscode-css-language-server", args: ["--stdio"] }],
    installHint: "npm i -g vscode-langservers-extracted",
  },
  "vscode-html": {
    group: "vscode-html",
    candidates: [{ command: "vscode-html-language-server", args: ["--stdio"] }],
    installHint: "npm i -g vscode-langservers-extracted",
  },
};

export function languageIdFor(file: string): string | undefined {
  return EXT_LANGUAGE[extname(file).toLowerCase()];
}

export function serverGroupFor(languageId: string): string | undefined {
  return LANGUAGE_GROUP[languageId];
}

const executableCache = new Map<string, string | null>();

/** Windows resolves executables via PATHEXT; posix uses the bare name. */
function pathExtensions(): string[] {
  if (process.platform !== "win32") return [""];
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase());
  return ["", ...exts];
}

/** Resolve `command` against PATH (honoring PATHEXT on Windows). Cached. */
export function onPath(command: string): boolean {
  if (executableCache.has(command)) return executableCache.get(command) !== null;
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = pathExtensions();
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) {
        executableCache.set(command, candidate);
        return true;
      }
    }
  }
  executableCache.set(command, null);
  return false;
}

export interface ResolvedServer {
  group: string;
  command: string;
  args: string[];
  installHint: string;
}

/**
 * Find an installed language server for a group. An env override
 * `PERSONACODE_LSP_<GROUP>="cmd arg1 arg2"` (e.g. PERSONACODE_LSP_TYPESCRIPT) wins.
 * Returns undefined (with the install hint available separately) when none is found.
 */
export function resolveServer(group: string): ResolvedServer | undefined {
  const spec = SERVERS[group];
  if (!spec) return undefined;

  const override = process.env[`PERSONACODE_LSP_${group.toUpperCase().replace(/-/g, "_")}`];
  if (override) {
    const [command, ...args] = override.split(/\s+/).filter(Boolean);
    if (command) return { group, command, args, installHint: spec.installHint };
  }

  for (const candidate of spec.candidates) {
    if (onPath(candidate.command)) {
      return { group, command: candidate.command, args: candidate.args, installHint: spec.installHint };
    }
  }
  return undefined;
}

export function installHintFor(group: string): string | undefined {
  return SERVERS[group]?.installHint;
}
