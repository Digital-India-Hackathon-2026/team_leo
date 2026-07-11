import { convertToModelMessages, createUIMessageStream } from "ai";
import type { ToolSet, UIMessage, UIMessageChunk } from "ai";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LanguageCode, TokenUsage } from "@personacode/contracts";
import { buildTools } from "../tools/index.js";
import { defaultModelRef, isMockMode } from "../providers/registry.js";
import { modelForRole } from "../providers/roles.js";
import { runFinishHooks } from "../hooks/index.js";
import { generateWithFallback } from "./loop.js";
import { detectVerifyCommands, runVerify } from "./verify.js";
import { getDiagnostics } from "../lsp/index.js";
import { captureReviewBaseline, reviewAgentResult } from "./reviewer.js";
import {
  MODE_HINTS,
  SYSTEM_PROMPT,
  TERSE_SYSTEM_PROMPT,
  lastUserText,
  pumpTurn,
  responseDirectives,
  type AgentTurnResult,
} from "./turn.js";

/**
 * PAV Loop — Plan → Apply → Verify (the plan's #10). A brain model drafts a concrete
 * plan (persisted to `.personacode/plans/`), an Apply pass edits files to execute it
 * (reusing the same streaming+fallback turn as normal chat), then Verify runs the
 * repo's own typecheck/test scripts. On failure the specific errors are fed back and
 * the loop re-applies, up to `maxIterations`. Each phase is streamed as a `data-pav`
 * chunk so clients can render the pipeline. Strictly opt-in via ChatRequest.pav.
 *
 * Apply runs in EDIT mode (write files, no model-initiated shell) — the only shell
 * that runs is the deterministic verify command derived from package.json, never
 * model-suggested commands.
 */
export interface PavRunOptions {
  messages: UIMessage[];
  modelRef?: string;
  cwd?: string;
  /** Extra tools (e.g. from MCP) merged into the Apply tool set. */
  extraTools?: ToolSet;
  disabledTools?: string[];
  /** Injected project context (PERSONA.md + memory + skills), same as a normal turn. */
  system?: string;
  language?: LanguageCode;
  terse?: boolean;
  /** Max Apply→Verify iterations before giving up (default 3, env PERSONACODE_PAV_MAX_ITER). */
  maxIterations?: number;
  onFinishTurn?: (r: AgentTurnResult) => void | Promise<void>;
  onFallback?: (from: string, to: string, reason: string) => void;
}

export interface PavStage {
  phase: "plan" | "apply" | "review" | "verify" | "done";
  detail: string;
  model?: string;
  ms?: number;
  iteration?: number;
  passed?: boolean;
  /** plan phase: the plan markdown + where it was saved. */
  plan?: string;
  planPath?: string;
  /** verify phase: the command run and (on failure) its captured output. */
  command?: string;
  output?: string;
}

const planPrompt = (task: string, language?: LanguageCode, terse = false): string =>
  `You are the PLANNER in a Plan→Apply→Verify loop for a coding task on the user's local repository.\n\n` +
  `TASK: ${task}\n\n` +
  `Write a concise, concrete implementation plan in Markdown:\n` +
  `- "## Goal" — one line.\n` +
  `- "## Steps" — a short numbered list of specific edits (which file, what change). Minimum set of steps.\n` +
  `- "## Verification" — what a passing result looks like (the loop runs the repo's own typecheck/test scripts).\n\n` +
  `Do NOT write the code yet — just the plan. Be terse.` +
  responseDirectives(language, terse);

const mockPlan = (task: string): string =>
  `## Goal\n${task || "Make the requested change"}.\n\n` +
  `## Steps\n1. Locate the relevant file(s).\n2. Apply the minimal edit to satisfy the task.\n3. Keep types and existing behaviour intact.\n\n` +
  `## Verification\nRepo typecheck passes.`;

function slugify(task: string): string {
  return (
    task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "plan"
  );
}

/** Persist the plan under `.personacode/plans/`; returns the workspace-relative path. */
export async function writePlanFile(cwd: string, task: string, markdown: string): Promise<string> {
  const rel = join(".personacode", "plans", `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${slugify(task)}.md`);
  const full = join(cwd, rel);
  await mkdir(join(cwd, ".personacode", "plans"), { recursive: true });
  await writeFile(full, `# PAV Plan: ${task}\n\n_generated ${new Date().toISOString()}_\n\n${markdown}\n`, "utf8");
  return rel.replace(/\\/g, "/");
}

export function runPavLoop(opts: PavRunOptions): ReadableStream<UIMessageChunk> {
  const cwd = opts.cwd ?? process.cwd();
  const primary = opts.modelRef ?? defaultModelRef();
  const maxIter = Math.max(1, opts.maxIterations ?? Number(process.env.PERSONACODE_PAV_MAX_ITER ?? 3));

  return createUIMessageStream({
    execute: async ({ writer }) => {
      const emit = (s: PavStage) => writer.write({ type: "data-pav", data: s } as unknown as UIMessageChunk);
      const task = lastUserText(opts.messages);
      const modelMessages = await convertToModelMessages(opts.messages);
      const reviewBaseline = await captureReviewBaseline(cwd);

      const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      const addUsage = (u: TokenUsage) => {
        totalUsage.inputTokens += u.inputTokens;
        totalUsage.outputTokens += u.outputTokens;
        totalUsage.totalTokens += u.totalTokens;
      };
      let finalText = "";
      let usedRef = primary;

      // ---------- PLAN ----------
      const planStart = Date.now();
      let planMarkdown: string;
      let planModel = primary;
      if (isMockMode()) {
        planMarkdown = mockPlan(task);
        planModel = "mock/mock-1";
      } else {
        try {
          const r = await generateWithFallback(planPrompt(task, opts.language, opts.terse), modelForRole("brain"));
          planMarkdown = r.text.trim() || "(planner returned no plan)";
          planModel = r.model;
          addUsage(r.usage);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emit({ phase: "plan", ms: Date.now() - planStart, detail: `plan step failed: ${msg}` });
          writer.write({ type: "error", errorText: `PAV plan step failed: ${msg}` });
          return;
        }
      }
      const planPath = await writePlanFile(cwd, task, planMarkdown).catch(() => undefined);
      emit({ phase: "plan", model: planModel, ms: Date.now() - planStart, detail: "plan ready", plan: planMarkdown, planPath });

      // ---------- APPLY → VERIFY loop ----------
      const verifyCmds = isMockMode() ? [] : detectVerifyCommands(cwd);
      // Files the Apply pass writes each iteration — fed to the language server for
      // per-file diagnostics before the (slower) whole-repo verify runs.
      const editedFiles = new Set<string>();
      // EDIT mode: the Apply pass may write files but cannot run shell commands.
      const tools: ToolSet = {
        ...buildTools({
          mode: "edit",
          cwd,
          disabled: new Set(opts.disabledTools ?? []),
          onFileWrite: (p) => editedFiles.add(p),
        }),
        ...(opts.extraTools ?? {}),
      };

      let attemptLog = "";
      let passed = false;
      let runs = 0;

      for (let i = 0; i < maxIter; i++) {
        runs = i + 1;
        editedFiles.clear();

        // APPLY
        const applyStart = Date.now();
        emit({ phase: "apply", iteration: runs, detail: i === 0 ? "executing the plan" : "fixing verification failures" });
        const applySystem =
          (opts.terse ? TERSE_SYSTEM_PROMPT : SYSTEM_PROMPT) +
          MODE_HINTS.edit +
          (opts.system ? `\n${opts.system}` : "") +
          `\n\nYou are in the APPLY phase of a Plan→Apply→Verify loop. Execute this approved plan now by editing files with the write_file tool — make the real changes, don't just describe them.\n\nPLAN:\n${planMarkdown}` +
          attemptLog +
          responseDirectives(opts.language, opts.terse);

        const { result, error } = await pumpTurn({
          writer,
          modelMessages,
          baseSystem: applySystem,
          tools,
          primary,
          sendStart: i === 0,
          onFallback: opts.onFallback,
        });
        if (error !== undefined) {
          writer.write({ type: "error", errorText: error });
          return;
        }
        if (result) {
          addUsage(result.usage);
          finalText = result.text;
          usedRef = result.modelRef;
        }
        emit({ phase: "apply", iteration: runs, model: usedRef, ms: Date.now() - applyStart, detail: "changes applied" });

        // LSP DIAGNOSTICS — fast per-file check on exactly the files this pass edited,
        // using an installed language server. If it finds type/syntax errors we feed
        // them straight back into the next Apply (cheaper + more precise than waiting
        // for the whole-repo verify). Skipped in mock mode and when no server is present.
        if (!isMockMode() && editedFiles.size) {
          const lspStart = Date.now();
          const report = await getDiagnostics(cwd, [...editedFiles]).catch(() => undefined);
          if (report && report.errorCount > 0) {
            emit({
              phase: "verify",
              iteration: runs,
              ms: Date.now() - lspStart,
              passed: false,
              detail: `language server found ${report.errorCount} error(s) ✗`,
              command: "lsp diagnostics",
              output: report.text,
            });
            attemptLog += `\n\nATTEMPT ${runs} — language server diagnostics found errors in the edited files:\n${report.text}\nFix these specific problems in your next edits.`;
            continue;
          }
          if (report && report.ran.length) {
            emit({
              phase: "verify",
              iteration: runs,
              ms: Date.now() - lspStart,
              passed: true,
              detail: "language server: no errors ✓",
              command: "lsp diagnostics",
            });
          }
        }

        // REVIEWER quality gate. It prefers a provider different from the Apply model.
        const review = await reviewAgentResult({
          cwd,
          task,
          plan: planMarkdown,
          result: finalText,
          avoidModel: usedRef,
          baseline: reviewBaseline,
        });
        addUsage(review.usage);
        emit({
          phase: "review",
          iteration: runs,
          model: review.model,
          ms: review.ms,
          passed: review.passed,
          detail: review.critique,
          output: review.passed ? undefined : review.critique,
        });
        if (!review.passed) {
          attemptLog += `\n\nATTEMPT ${runs} did NOT pass reviewer quality gate.\n${review.critique}\nFix this blocking issue in your next edits.`;
          continue;
        }

        // VERIFY
        const verifyStart = Date.now();
        if (isMockMode()) {
          emit({ phase: "verify", iteration: runs, ms: Date.now() - verifyStart, passed: true, detail: "(mock) checks passed", command: "typecheck" });
          passed = true;
          break;
        }
        emit({
          phase: "verify",
          iteration: runs,
          detail: verifyCmds.length ? `running ${verifyCmds.join(" && ")}` : "no checks configured",
        });
        const v = await runVerify(verifyCmds, cwd);
        passed = v.passed;
        emit({
          phase: "verify",
          iteration: runs,
          ms: Date.now() - verifyStart,
          passed: v.passed,
          detail: v.skipped
            ? "no verify scripts detected — skipped"
            : v.passed
              ? "all checks passed ✓"
              : `checks failed ✗ (${v.command})`,
          command: v.command,
          output: v.passed ? undefined : v.output,
        });
        if (passed || v.skipped) {
          passed = true;
          break;
        }
        // Feed the specific failure into the next Apply pass via system text (keeps the
        // message history clean and provider-safe — no injected system-role messages).
        attemptLog += `\n\nATTEMPT ${runs} did NOT pass verification.\nCommand: ${v.command}\nOutput:\n${v.output}\nFix these specific problems in your next edits.`;
      }

      emit({
        phase: "done",
        iteration: runs,
        passed,
        detail: passed ? `verified ✓ after ${runs} iteration(s)` : `stopped after ${maxIter} iteration(s) — still failing`,
      });

      const finalResult = { text: finalText, usage: totalUsage, modelRef: usedRef };
      await runFinishHooks(cwd, { result: finalResult }).catch(() => undefined);
      if (opts.onFinishTurn) await opts.onFinishTurn(finalResult);
    },
  });
}
