import type {
  AnalysisReport,
  HealthScore,
  ProjectInsights,
  Severity,
} from "./types.js"

/** Per-occurrence point deduction by severity. Mirrors the dashboard. */
const PENALTY: Record<Severity, number> = {
  critical: 28,
  error: 22,
  high: 16,
  medium: 8,
  warning: 7,
  low: 3,
  info: 1,
}

function scoreFromSeverities(sevs: Severity[]): number {
  let s = 100
  for (const sev of sevs) s -= PENALTY[sev] ?? 4
  return Math.max(0, Math.min(100, Math.round(s)))
}

export function gradeForScore(score: number): HealthScore["grade"] {
  if (score >= 95) return "A+"
  if (score >= 90) return "A"
  if (score >= 80) return "B"
  if (score >= 70) return "C"
  if (score >= 60) return "D"
  return "F"
}

/**
 * Roll all eleven analysis surfaces into one weighted score — identical
 * weighting to the dashboard's `computeUnifiedHealth`, so the CLI's CI summary
 * and trend history agree with what users see in the UI.
 */
export function computeHealth(
  report: Pick<AnalysisReport, "lint" | "types" | "security" | "deps">,
  insights: ProjectInsights,
): HealthScore {
  const { lint, types, security, deps } = report
  const { env, network, git, docs, database, accessibility, performance, tests } = insights

  const lintScore = scoreFromSeverities(lint.messages.map((m) => m.severity))
  const typeScore = scoreFromSeverities(types.diagnostics.map(() => "error" as Severity))
  const securityScore = scoreFromSeverities([
    ...security.findings.map((f) => f.severity),
    ...security.dependencies.map((d) => d.severity),
  ])
  const depScore = scoreFromSeverities(deps.findings.map((f) => f.severity))
  const dbScore = scoreFromSeverities(database.findings.map((f) => f.severity))
  const envIssues = env.variables.filter((v) => v.status !== "ok")
  const envScore = scoreFromSeverities(envIssues.map((v) => v.severity))
  const netIssues = network.calls.flatMap((c) => c.issues.map((i) => i.severity))
  const netScore = scoreFromSeverities(netIssues)
  const gitIssues = [...git.issues, ...git.workflows.flatMap((w) => w.issues)]
  const gitScore = scoreFromSeverities(gitIssues.map((g) => g.severity))
  const docChecks = docs.standards.flatMap((s) => s.checks)
  const docScore = docChecks.length
    ? Math.round((docChecks.filter((c) => c.status === "pass").length / docChecks.length) * 100)
    : 100
  const a11yScore = accessibility.score
  const perfScore = performance.score
  const passRate = tests.counts.total ? tests.counts.passed / tests.counts.total : 1
  const testScore = Math.max(
    0,
    Math.min(100, Math.round(tests.coverage.lines * 0.5 + passRate * 100 * 0.5 - tests.counts.failed * 3)),
  )

  const weighted: { score: number; weight: number }[] = [
    { score: securityScore, weight: 0.2 },
    { score: typeScore, weight: 0.12 },
    { score: depScore, weight: 0.12 },
    { score: lintScore, weight: 0.1 },
    { score: dbScore, weight: 0.1 },
    { score: testScore, weight: 0.1 },
    { score: perfScore, weight: 0.08 },
    { score: a11yScore, weight: 0.08 },
    { score: envScore, weight: 0.04 },
    { score: netScore, weight: 0.03 },
    { score: docScore, weight: 0.03 },
  ]

  const weightTotal = weighted.reduce((s, c) => s + c.weight, 0) || 1
  const score = Math.round(weighted.reduce((s, c) => s + c.score * c.weight, 0) / weightTotal)

  return {
    score,
    grade: gradeForScore(score),
    breakdown: { lint: lintScore, types: typeScore, security: securityScore },
  }
}
