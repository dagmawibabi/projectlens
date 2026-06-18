/**
 * Client-side mirror of the JSON the CodeLens CLI emits (see cli/src/types.ts).
 * The dashboard renders against these types whether data comes from live
 * WebSocket events or the bundled mock fixture.
 */

export type Severity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info"
  | "error"
  | "warning"

export interface ProjectInfo {
  root: string
  framework: string
  packageManager: "npm" | "pnpm" | "yarn" | "bun"
  hasTypeScript: boolean
  hasLintScript: boolean
}

export interface LintMessage {
  filePath: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  severity: "error" | "warning"
  ruleId: string | null
  message: string
  fixable: boolean
  /** Optional source snippet for inline preview (lines around the issue). */
  snippet?: { startLine: number; code: string }
}

export interface LintResult {
  messages: LintMessage[]
  errorCount: number
  warningCount: number
  fixableCount: number
  unavailable?: boolean
  note?: string
}

export interface TypeDiagnostic {
  filePath: string
  line: number
  column: number
  code: string
  message: string
  related: { message: string; depth: number }[]
}

export interface TypeCheckResult {
  diagnostics: TypeDiagnostic[]
  unavailable?: boolean
  note?: string
}

export type SecurityCategory =
  | "injection"
  | "secrets"
  | "auth"
  | "xss"
  | "ssrf"
  | "crypto"
  | "config"
  | "data-exposure"
  | "other"

export interface SecurityFinding {
  id: string
  title: string
  severity: "critical" | "high" | "medium" | "low" | "info"
  category: SecurityCategory
  filePath: string
  line: number
  endLine?: number
  description: string
  recommendation: string
  suggestedFix?: string
  confidence: number
  reference?: string
  snippet?: { startLine: number; code: string }
}

export interface DependencyVuln {
  name: string
  currentVersion: string
  dependencyType: "direct" | "transitive" | "dev"
  severity: "critical" | "high" | "medium" | "low" | "info"
  title: string
  cves: string[]
  fixedIn?: string
  impact?: string
}

export interface SecurityResult {
  findings: SecurityFinding[]
  dependencies: DependencyVuln[]
  skipped?: boolean
}

export type DependencyKind = "direct" | "dev" | "peer" | "transitive"

export type DependencyIssueKind =
  | "vulnerability"
  | "outdated"
  | "deprecated"
  | "unused"
  | "missing"
  | "license"

export interface DependencyFinding {
  id: string
  /** Package name. */
  name: string
  /** Installed version. */
  current: string
  /** Latest published version, when known. */
  latest?: string
  /** Where the dependency sits in the tree. */
  type: DependencyKind
  kind: DependencyIssueKind
  severity: Severity
  /** One-line summary of the issue. */
  title: string
  /** Expanded explanation of the problem and its impact. */
  detail: string
  /** What the developer should do about it. */
  recommendation?: string
  /** Version that resolves the issue (for vulns / outdated). */
  fixedIn?: string
  /** Associated CVE identifiers. */
  cves?: string[]
  /** SPDX license id, for license findings. */
  license?: string
  /** Files where the package is imported (for unused / missing). */
  usedIn?: string[]
  /** External reference (advisory, npm page, docs). */
  reference?: string
}

export interface DependencyResult {
  counts: { total: number; direct: number; dev: number; transitive: number }
  findings: DependencyFinding[]
  /** The manifest file these findings were derived from. */
  manifestPath: string
}

export interface HealthScore {
  score: number
  grade: "A+" | "A" | "B" | "C" | "D" | "F"
  breakdown: { lint: number; types: number; security: number }
}

export interface RunMeta {
  id: string
  cwd: string
  project: ProjectInfo
  startedAt: string
  finishedAt: string
  durationMs: number
  aiEnabled: boolean
}

export interface AnalysisReport {
  meta: RunMeta
  health: HealthScore
  lint: LintResult
  types: TypeCheckResult
  security: SecurityResult
  deps: DependencyResult
}

export interface TrendPoint {
  runId: string
  timestamp: string
  score: number
  lintErrors: number
  lintWarnings: number
  typeErrors: number
  securityFindings: number
}

export type RunPhase = "detect" | "lint" | "types" | "deps" | "security"
export type PhaseStatus = "idle" | "running" | "done" | "skipped"
