import { randomUUID } from "node:crypto"
import { computeHealth } from "./health.js"
import type {
  LintResult,
  TypeCheckResult,
  SecurityResult,
  DependencyResult,
  AnalysisReport,
  RunMeta,
  ProjectInsights,
} from "./types.js"

export { computeHealth, gradeForScore } from "./health.js"

/**
 * Assemble the final AnalysisReport. Health is computed from all surfaces
 * (lint/types/security/deps + the project insights) via the unified scorer in
 * health.ts, so it matches what the dashboard renders.
 */
export function buildReport(args: {
  meta: Omit<RunMeta, "id" | "finishedAt" | "durationMs">
  startedAt: number
  lint: LintResult
  types: TypeCheckResult
  security: SecurityResult
  deps: DependencyResult
  insights: ProjectInsights
}): AnalysisReport {
  const { meta, startedAt, lint, types, security, deps, insights } = args
  const finishedAt = Date.now()

  return {
    meta: {
      ...meta,
      id: randomUUID(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
    },
    health: computeHealth({ lint, types, security, deps }, insights),
    lint,
    types,
    security,
    deps,
  }
}
