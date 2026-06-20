import { detectProject } from "./detect.js"
import { runEslint } from "./runners/eslint.js"
import { runTsc } from "./runners/tsc.js"
import { runAudit } from "./runners/audit.js"
import { runSecurityAudit } from "./ai/audit.js"
import { buildReport } from "./report.js"
import { buildDependencyResult } from "./deps-graph.js"
import { collectInsights, ScanContext } from "./insights/index.js"
import type { AnalysisReport, DashboardState, ProjectInsights, RunEvent, TrendPoint } from "./types.js"

export type RunScope = "all" | "security"

export interface RunOptions {
  cwd: string
  /** Skip the AI security pass (no model key, or --no-ai). */
  ai: boolean
  /** Prior trend history to attach to the emitted state. */
  history?: TrendPoint[]
  /** Callback for streaming progress to the dashboard. */
  onEvent?: (event: RunEvent) => void
  /**
   * Which checks to run. `"security"` re-runs only the AI security pass and
   * reuses every other result from `prior`, for a fast targeted rescan. Falls
   * back to a full run when no prior result is available.
   */
  scope?: RunScope
  /** Previous dashboard state, required for a `"security"`-scoped rescan. */
  prior?: DashboardState | null
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
  const { cwd, ai, onEvent, scope = "all", prior } = opts
  const emit = (e: RunEvent) => onEvent?.(e)
  const startedAt = Date.now()

  // Targeted rescan: re-run only the AI security pass and reuse everything else
  // from the previous run. Falls through to a full run if there's no prior data.
  if (scope === "security" && prior?.report) {
    return runSecurityOnly({ cwd, ai, prior, history: opts.history, emit, startedAt })
  }

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

/**
 * Fast, targeted rescan: recompute only the AI security pass while reusing the
 * lint, type-check, dependency and insight results from the previous run. The
 * non-security phases are emitted as already-`done` so the run view stays
 * consistent, and the report's health score is recomputed from the fresh
 * security result + the reused surfaces.
 */
async function runSecurityOnly(args: {
  cwd: string
  ai: boolean
  prior: DashboardState
  history?: TrendPoint[]
  emit: (e: RunEvent) => void
  startedAt: number
}): Promise<RunResult> {
  const { cwd, ai, prior, emit, startedAt } = args
  const priorReport = prior.report
  const project = priorReport.meta.project

  // Reuse every non-security surface from the previous run.
  emit({ type: "phase", phase: "detect", status: "done", project })
  emit({ type: "phase", phase: "lint", status: "done", lint: priorReport.lint })
  emit({ type: "phase", phase: "types", status: "done", types: priorReport.types })
  emit({ type: "phase", phase: "deps", status: "done" })

  emit({ type: "phase", phase: "security", status: ai ? "running" : "skipped" })
  const advisories = priorReport.security.dependencies
  const security = ai
    ? await runSecurityAudit({ cwd, project, advisories, lint: priorReport.lint, types: priorReport.types })
    : { findings: [], dependencies: advisories, skipped: true as const }
  emit({ type: "phase", phase: "security", status: "done", security })

  emit({ type: "phase", phase: "insights", status: "done" })

  const report = buildReport({
    meta: {
      cwd,
      project,
      startedAt: new Date(startedAt).toISOString(),
      aiEnabled: ai,
    },
    startedAt,
    lint: priorReport.lint,
    types: priorReport.types,
    security,
    deps: priorReport.deps,
    insights: prior.insights,
  })

  emit({ type: "report", report })
  const history = [...(args.history ?? [])]
  const state: DashboardState = { report, insights: prior.insights, history }
  emit({ type: "state", state })

  return { report, insights: prior.insights }
}
