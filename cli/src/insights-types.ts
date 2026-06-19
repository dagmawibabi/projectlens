/**
 * Engine-side types for the extended project intelligence the CLI collects
 * beyond lint/types/security/deps: environment variables, network calls,
 * git + CI/CD state, project setup, documentation, database, accessibility,
 * performance, and tests.
 *
 * These MUST stay in sync with the dashboard's `lib/project-insights.ts`,
 * which mirrors this shape on the client.
 */
import type { Severity } from "./types.js"

/* ------------------------------------------------------------------ */
/* Environment variables                                               */
/* ------------------------------------------------------------------ */

export type EnvScope = "client" | "server"

export type EnvStatus = "ok" | "missing" | "undocumented" | "unused" | "exposed" | "empty"

export interface EnvVariable {
  key: string
  scope: EnvScope
  status: EnvStatus
  severity: Severity
  usedIn: string[]
  definedIn: string[]
  note: string
  sample?: string
  /** Raw, unmasked value parsed from the local env file. Read only from the
   *  developer's own machine and revealed behind an explicit toggle. */
  value?: string
}

export interface EnvResult {
  files: { path: string; present: boolean; vars: number }[]
  variables: EnvVariable[]
  counts: { total: number; client: number; server: number; issues: number }
}

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

export type NetworkClient = "fetch" | "axios" | "ky" | "xhr" | "script" | "image" | "websocket"

export interface NetworkIssue {
  kind: "insecure" | "no-timeout" | "no-error-handling" | "hardcoded-url" | "cors-wildcard" | "no-auth" | "mixed-content"
  severity: Severity
  message: string
}

export interface NetworkCall {
  id: string
  method: string
  url: string
  host: string
  external: boolean
  secure: boolean
  client: NetworkClient
  filePath: string
  line: number
  issues: NetworkIssue[]
}

export interface NetworkDomain {
  host: string
  calls: number
  external: boolean
  category: "api" | "cdn" | "analytics" | "auth" | "payment" | "internal" | "other"
}

export interface NetworkResult {
  calls: NetworkCall[]
  domains: NetworkDomain[]
  counts: { total: number; external: number; insecure: number; issues: number }
}

/* ------------------------------------------------------------------ */
/* Git + CI/CD                                                         */
/* ------------------------------------------------------------------ */

export interface GitFileChange {
  path: string
  status: "modified" | "added" | "deleted" | "untracked" | "renamed"
}

export interface GitIssue {
  id: string
  kind: "secret-in-history" | "large-file" | "gitignore" | "uncommitted" | "stale-branch" | "no-signoff" | "force-push"
  severity: Severity
  title: string
  detail: string
  filePath?: string
  recommendation?: string
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  relative: string
}

export interface GitBranch {
  name: string
  current: boolean
  /** True for remote-tracking branches (e.g. origin/main). */
  remote: boolean
  /** Upstream tracking ref, if the branch tracks one. */
  upstream?: string
  /** Relative time of the branch tip's last commit. */
  lastCommitRelative?: string
}

/** Parsed from the `origin` remote URL; powers the repo link in the UI. */
export interface GitRemoteInfo {
  provider: "GitHub" | "GitLab" | "Bitbucket" | "Other"
  owner: string
  name: string
  /** Browsable https URL for the repository. */
  url: string
  host: string
}

export interface GitState {
  branch: string
  defaultBranch: string
  ahead: number
  behind: number
  remote: string
  /** Structured remote metadata (owner/name/url), when an origin is set. */
  remoteInfo?: GitRemoteInfo
  lastCommit: { hash: string; message: string; author: string; relative: string }
  /** Most recent commits on the current branch, newest first. */
  recentCommits: GitCommit[]
  /** Local and remote-tracking branches. */
  branches: GitBranch[]
  /** Lightweight tags, newest first. */
  tags: string[]
  /** Git-ignored files: total count plus a sample for display. */
  ignored: { count: number; samples: string[] }
  /** Number of stash entries. */
  stashes: number
  changes: GitFileChange[]
  staged: number
  contributors: number
  totalCommits: number
}

export type CiStatus = "passing" | "failing" | "no-runs" | "disabled"

export interface CiJob {
  name: string
  status: CiStatus
  durationMs?: number
}

export interface CiWorkflow {
  id: string
  name: string
  file: string
  provider: "GitHub Actions" | "GitLab CI" | "CircleCI" | "Other"
  triggers: string[]
  status: CiStatus
  jobs: CiJob[]
  issues: GitIssue[]
}

export interface GitResult {
  state: GitState
  issues: GitIssue[]
  workflows: CiWorkflow[]
}

/* ------------------------------------------------------------------ */
/* Project setup / configuration                                       */
/* ------------------------------------------------------------------ */

export interface ConfigEntry {
  id: string
  name: string
  file: string
  present: boolean
  tool: string
  summary: string
  highlights?: { label: string; value: string; good?: boolean }[]
  ruleCount?: number
}

export interface LanguageStat {
  language: string
  files: number
  loc: number
  share: number
}

export interface WorkspaceStats {
  totalFiles: number
  totalLoc: number
  codeLoc: number
  commentLoc: number
  blankLoc: number
  testFiles: number
  testLoc: number
  components: number
  routes: number
  largestFiles: { path: string; loc: number }[]
  languages: LanguageStat[]
  commentRatio: number
  testRatio: number
  todoCount: number
}

export interface SetupResult {
  configs: ConfigEntry[]
  stats: WorkspaceStats
  tooling: { name: string; version?: string; detected: boolean }[]
}

/* ------------------------------------------------------------------ */
/* Documentation / AI readiness                                        */
/* ------------------------------------------------------------------ */

export type DocCheckStatus = "pass" | "warn" | "fail" | "na"
export type DocBand = "excellent" | "good" | "needs-improvement" | "poor"

export interface DocCheck {
  id: string
  label: string
  status: DocCheckStatus
  detail: string
  weight: number
  group?: string
  agent: boolean
  fix?: string
}

export interface DocStandard {
  id: "vercel" | "llmstxt" | "farming" | "quality"
  label: string
  tagline: string
  source: string
  href: string
  score: number
  weight: number
  band: DocBand
  liveOnly?: boolean
  checks: DocCheck[]
}

export interface DocFile {
  name: string
  path: string
  present: boolean
  score: number
  words: number
  note: string
}

export interface DocsResult {
  score: number
  grade: "A+" | "A" | "B" | "C" | "D" | "F"
  band: DocBand
  agentReady: boolean
  agentScore: number
  liveUrl: string | null
  standards: DocStandard[]
  documents: DocFile[]
}

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

export type DbEngine = "postgres" | "mysql" | "mongodb" | "sqlite" | "redis" | "other"

export type DbIssueKind =
  | "n+1"
  | "missing-index"
  | "no-pooling"
  | "injection"
  | "unparameterized"
  | "schema-drift"
  | "no-migration"
  | "unbounded-query"
  | "no-ssl"
  | "connection-leak"
  | "missing-ttl"
  | "full-scan"
  | "no-validation"

export interface DbConnection {
  id: string
  engine: DbEngine
  name: string
  client: string
  host: string
  ssl: boolean
  pooled: boolean
  envVar: string
  collections: number
  filePath: string
}

export interface DbFinding {
  id: string
  engine: DbEngine
  kind: DbIssueKind
  severity: Severity
  title: string
  detail: string
  filePath: string
  line?: number
  recommendation: string
  snippet?: { startLine: number; code: string }
  target?: string
}

export interface DbQuery {
  id: string
  engine: DbEngine
  operation: string
  target: string
  filePath: string
  line: number
  estMs: number
  fullScan: boolean
  note: string
}

export interface DbResult {
  connections: DbConnection[]
  findings: DbFinding[]
  queries: DbQuery[]
  counts: { connections: number; collections: number; findings: number; slowQueries: number }
}

/* ------------------------------------------------------------------ */
/* Accessibility                                                       */
/* ------------------------------------------------------------------ */

export type A11yImpact = "critical" | "serious" | "moderate" | "minor"

export type WcagPrinciple = "Perceivable" | "Operable" | "Understandable" | "Robust"

export interface A11yViolation {
  id: string
  rule: string
  impact: A11yImpact
  principle: WcagPrinciple
  wcag: string[]
  description: string
  help: string
  helpUrl: string
  filePath: string
  line: number
  selector: string
  nodes: number
  recommendation: string
  snippet?: { startLine: number; code: string }
}

export interface A11yResult {
  score: number
  violations: A11yViolation[]
  passes: number
  incomplete: number
  counts: { critical: number; serious: number; moderate: number; minor: number }
  byPrinciple: { principle: WcagPrinciple; count: number }[]
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export type VitalRating = "good" | "needs-improvement" | "poor"

export interface WebVital {
  id: "LCP" | "INP" | "CLS" | "FCP" | "TTFB"
  label: string
  value: number
  unit: string
  rating: VitalRating
  threshold: { good: number; poor: number }
}

export interface BundleRoute {
  route: string
  sizeKb: number
  firstLoadKb: number
  rating: VitalRating
}

export type PerfIssueKind =
  | "large-bundle"
  | "render-blocking"
  | "unoptimized-image"
  | "no-memo"
  | "large-dependency"
  | "duplicate-dependency"
  | "no-code-split"
  | "sync-script"
  | "layout-shift"

export interface PerfFinding {
  id: string
  kind: PerfIssueKind
  severity: Severity
  title: string
  detail: string
  filePath: string
  line?: number
  recommendation: string
  estimatedSavingKb?: number
  snippet?: { startLine: number; code: string }
}

export interface PerfResult {
  score: number
  vitals: WebVital[]
  bundles: BundleRoute[]
  findings: PerfFinding[]
  totalBundleKb: number
  counts: { findings: number }
}

/* ------------------------------------------------------------------ */
/* Tests & Coverage                                                    */
/* ------------------------------------------------------------------ */

export type TestStatus = "passed" | "failed" | "skipped"

export interface TestSuite {
  id: string
  name: string
  filePath: string
  total: number
  passed: number
  failed: number
  skipped: number
  durationMs: number
  status: TestStatus
}

export type TestIssueKind = "failing" | "flaky" | "slow" | "uncovered" | "no-tests"

export interface TestFinding {
  id: string
  kind: TestIssueKind
  severity: Severity
  title: string
  detail: string
  filePath: string
  line?: number
  recommendation: string
  snippet?: { startLine: number; code: string }
}

export interface CoverageFile {
  filePath: string
  lines: number
  functions: number
  branches: number
  statements: number
  uncoveredLines?: number[]
}

export interface TestsResult {
  framework: string
  coverage: { lines: number; functions: number; branches: number; statements: number }
  suites: TestSuite[]
  findings: TestFinding[]
  files: CoverageFile[]
  counts: {
    total: number
    passed: number
    failed: number
    skipped: number
    suites: number
    durationMs: number
  }
}

/* ------------------------------------------------------------------ */
/* Aggregate                                                           */
/* ------------------------------------------------------------------ */

export interface ProjectInsights {
  env: EnvResult
  network: NetworkResult
  git: GitResult
  setup: SetupResult
  docs: DocsResult
  database: DbResult
  accessibility: A11yResult
  performance: PerfResult
  tests: TestsResult
}
