import { detectProject } from "./detect.js"
import { runEslint } from "./runners/eslint.js"
import { runTsc } from "./runners/tsc.js"
import { runAudit } from "./runners/audit.js"
import { runSecurityAudit } from "./ai/audit.js"
import { buildReport } from "./report.js"
import { buildDependencyResult } from "./deps-graph.js"
import { collectInsights, ScanContext } from "./insights/index.js"
import type { AnalysisReport, DashboardState, ProjectInsights, RunEvent, TrendPoint } from "./types.js"

export interface RunOptions {
  cwd: string
  /** Skip the AI security pass (no model key, or --no-ai). */
  ai: boolean
  /** Prior trend history to attach to the emitted state. */
  history?: TrendPoint[]
  /** Callback for streaming progress to the dashboard. */
  onEvent?: (event: RunEvent) => void
}

export interface RunResult {
  report: AnalysisReport
  insights: ProjectInsights
}

/**
 * Full analysis pipeline. Each phase emits a streaming event so the dashboard
 * can render results progressively instead of waiting for the whole run.
 *
 * Lint, types, dependency audit, and AI security run first (they shell out to
 * the project's own toolchain), then a single shared filesystem scan powers
 * the dependency graph and all project-intelligence collectors.
 */
export async function runAnalysis(opts: RunOptions): Promise<RunResult> {
  const { cwd, ai, onEvent } = opts
  const emit = (e: RunEvent) => onEvent?.(e)
  const startedAt = Date.now()

  const project = await detectProject(cwd)
  emit({ type: "phase", phase: "detect", status: "done", project })

  // Lint
  emit({ type: "phase", phase: "lint", status: "running" })
  const lint = await runEslint(cwd, project)
  emit({ type: "phase", phase: "lint", status: "done", lint })

  // Types
  emit({ type: "phase", phase: "types", status: "running" })
  const types = await runTsc(cwd, project)
  emit({ type: "phase", phase: "types", status: "done", types })

  // Dependency audit (fast, deterministic) feeds the AI prioritization step.
  emit({ type: "phase", phase: "deps", status: "running" })
  const advisories = await runAudit(cwd, project)

  // AI security pass (code + dependency prioritization)
  emit({ type: "phase", phase: "security", status: ai ? "running" : "skipped" })
  const security = ai
    ? await runSecurityAudit({ cwd, project, advisories, lint, types })
    : { findings: [], dependencies: advisories, skipped: true as const }
  emit({ type: "phase", phase: "security", status: "done", security })

  // Single shared scan powers the dependency graph + every insight collector.
  emit({ type: "phase", phase: "insights", status: "running" })
  const scan = await ScanContext.create(cwd, project)
  const [deps, bundle] = await Promise.all([
    buildDependencyResult(scan, advisories),
    collectInsights(scan),
  ])
  emit({ type: "phase", phase: "deps", status: "done" })

  // Merge discovered type declarations into the type result for the explorer.
  types.definitions = bundle.typeDefinitions
  const insights = bundle.insights
  emit({ type: "phase", phase: "insights", status: "done" })

  const report = buildReport({
    meta: {
      cwd,
      project,
      startedAt: new Date(startedAt).toISOString(),
      aiEnabled: ai,
    },
    startedAt,
    lint,
    types,
    security,
    deps,
    insights,
  })

  emit({ type: "report", report })

  const history = [...(opts.history ?? [])]
  const state: DashboardState = { report, insights, history }
  emit({ type: "state", state })

  return { report, insights }
}
