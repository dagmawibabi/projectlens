import type { AnalysisReport, Severity } from "./schema"
import type { ProjectInsights } from "./project-insights"

/** One weighted surface that contributes to the composite health score. */
export interface HealthCategory {
  key: string
  label: string
  /** 0–100 sub-score for this surface. */
  score: number
  /** Relative contribution to the composite (weights sum to 1). */
  weight: number
  /** Number of issues feeding the score, for display. */
  issues: number
  /** Short context line shown under the label. */
  detail: string
}

export interface UnifiedHealth {
  score: number
  grade: "A+" | "A" | "B" | "C" | "D" | "F"
  categories: HealthCategory[]
}

/** Per-occurrence point deduction by severity. */
const PENALTY: Record<Severity, number> = {
  critical: 28,
  error: 22,
  high: 16,
  medium: 8,
  warning: 7,
  low: 3,
  info: 1,
}

/** Derive a 0–100 score from a list of issue severities. */
function scoreFromSeverities(sevs: Severity[]): number {
  let s = 100
  for (const sev of sevs) s -= PENALTY[sev] ?? 4
  return Math.max(0, Math.min(100, Math.round(s)))
}

export function gradeForScore(score: number): UnifiedHealth["grade"] {
  if (score >= 95) return "A+"
  if (score >= 90) return "A"
  if (score >= 80) return "B"
  if (score >= 70) return "C"
  if (score >= 60) return "D"
  return "F"
}

/**
 * Roll every analysis surface into a single weighted health score.
 * Unlike the CLI's three-factor score, this blends all eleven surfaces the
 * dashboard knows about so the Overview reflects the whole project.
 */
export function computeUnifiedHealth(report: AnalysisReport, insights: ProjectInsights): UnifiedHealth {
  const { lint, types, security, deps } = report
  const { env, network, git, docs, database, accessibility, performance, tests } = insights

  // Lint
  const lintScore = scoreFromSeverities(lint.messages.map((m) => m.severity))
  // Types
  const typeScore = scoreFromSeverities(types.diagnostics.map(() => "error" as Severity))
  // Security (findings + vulnerable deps)
  const securityScore = scoreFromSeverities([
    ...security.findings.map((f) => f.severity),
    ...security.dependencies.map((d) => d.severity),
  ])
  // Dependencies
  const depScore = scoreFromSeverities(deps.findings.map((f) => f.severity))
  // Database
  const dbScore = scoreFromSeverities(database.findings.map((f) => f.severity))
  // Environment
  const envIssues = env.variables.filter((v) => v.status !== "ok")
  const envScore = scoreFromSeverities(envIssues.map((v) => v.severity))
  // Network
  const netIssues = network.calls.flatMap((c) => c.issues.map((i) => i.severity))
  const netScore = scoreFromSeverities(netIssues)
  // Git & CI/CD
  const gitIssues = [...git.issues, ...git.workflows.flatMap((w) => w.issues)]
  const gitScore = scoreFromSeverities(gitIssues.map((g) => g.severity))
  // Docs — share of checks that pass.
  const docChecks = docs.standards.flatMap((s) => s.checks)
  const docFails = docChecks.filter((c) => c.status === "fail" || c.status === "warn")
  const docScore = docChecks.length
    ? Math.round((docChecks.filter((c) => c.status === "pass").length / docChecks.length) * 100)
    : 100
  // Accessibility & Performance carry their own scores.
  const a11yScore = accessibility.score
  const perfScore = performance.score
  // Tests — blend line coverage with pass rate, then dock failures.
  const passRate = tests.counts.total ? tests.counts.passed / tests.counts.total : 1
  const testScore = Math.max(
    0,
    Math.min(100, Math.round(tests.coverage.lines * 0.5 + passRate * 100 * 0.5 - tests.counts.failed * 3)),
  )

  const categories: HealthCategory[] = [
    { key: "security", label: "Security", weight: 0.2, score: securityScore, issues: security.findings.length + security.dependencies.length, detail: "findings + vuln deps" },
    { key: "types", label: "Types", weight: 0.12, score: typeScore, issues: types.diagnostics.length, detail: "tsc diagnostics" },
    { key: "deps", label: "Dependencies", weight: 0.12, score: depScore, issues: deps.findings.length, detail: "outdated, unused, vulns" },
    { key: "lint", label: "Lint", weight: 0.1, score: lintScore, issues: lint.messages.length, detail: "errors + warnings" },
    { key: "database", label: "Database", weight: 0.1, score: dbScore, issues: database.findings.length, detail: "query + schema issues" },
    { key: "tests", label: "Tests", weight: 0.1, score: testScore, issues: tests.counts.failed, detail: `${tests.coverage.lines}% line coverage` },
    { key: "perf", label: "Performance", weight: 0.08, score: perfScore, issues: performance.findings.length, detail: "bundle + web vitals" },
    { key: "a11y", label: "Accessibility", weight: 0.08, score: a11yScore, issues: accessibility.violations.length, detail: "WCAG violations" },
    { key: "env", label: "Environment", weight: 0.04, score: envScore, issues: envIssues.length, detail: "config + secrets" },
    { key: "network", label: "Network", weight: 0.03, score: netScore, issues: netIssues.length, detail: "outbound requests" },
    { key: "docs", label: "Documentation", weight: 0.03, score: docScore, issues: docFails.length, detail: "agent readiness" },
  ]

  const weightTotal = categories.reduce((s, c) => s + c.weight, 0) || 1
  const score = Math.round(categories.reduce((s, c) => s + c.score * c.weight, 0) / weightTotal)

  return { score, grade: gradeForScore(score), categories }
}
