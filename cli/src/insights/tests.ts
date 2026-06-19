import { promises as fs } from "node:fs"
import path from "node:path"
import { type ScanContext } from "./scan.js"
import type { TestsResult, TestSuite, TestFinding, CoverageFile, Severity } from "../types.js"

function detectFramework(ctx: ScanContext): string {
  if (ctx.hasDep("vitest")) return "Vitest"
  if (ctx.hasDep("jest")) return "Jest"
  if (ctx.hasDep("@playwright/test")) return "Playwright"
  if (ctx.hasDep("mocha")) return "Mocha"
  if (ctx.hasDep("ava")) return "AVA"
  if (ctx.hasDep("@testing-library/react")) return "Testing Library"
  return "none"
}

/** Read a coverage-summary.json if the project has one. */
async function readCoverage(root: string): Promise<{
  totals: { lines: number; functions: number; branches: number; statements: number }
  files: CoverageFile[]
} | null> {
  const candidates = [
    "coverage/coverage-summary.json",
    "coverage/coverage-final.json",
    ".nyc_output/coverage-summary.json",
  ]
  for (const rel of candidates) {
    try {
      const raw = await fs.readFile(path.join(root, rel), "utf8")
      const json = JSON.parse(raw) as Record<string, any>
      const total = json.total
      if (!total) continue
      const pct = (k: string) => Math.round(total[k]?.pct ?? 0)
      const files: CoverageFile[] = []
      for (const [key, val] of Object.entries(json)) {
        if (key === "total" || !val || typeof val !== "object") continue
        files.push({
          filePath: path.relative(root, key).split(path.sep).join("/"),
          lines: Math.round(val.lines?.pct ?? 0),
          functions: Math.round(val.functions?.pct ?? 0),
          branches: Math.round(val.branches?.pct ?? 0),
          statements: Math.round(val.statements?.pct ?? 0),
        })
      }
      return {
        totals: { lines: pct("lines"), functions: pct("functions"), branches: pct("branches"), statements: pct("statements") },
        files,
      }
    } catch {
      /* try next */
    }
  }
  return null
}

export async function collectTests(ctx: ScanContext): Promise<TestsResult> {
  const framework = detectFramework(ctx)
  const findings: TestFinding[] = []
  const suites: TestSuite[] = []

  const testFiles = ctx.files.filter((f) => f.isTest && f.isCode)

  // Enumerate suites by parsing test files (static — counts cases, not runs).
  for (const f of testFiles) {
    const content = await ctx.read(f.rel)
    if (!content) continue
    const cases = (content.match(/\b(it|test)\s*(\.\s*(only|skip|concurrent|each))?\s*\(/g) ?? []).length
    const skipped = (content.match(/\b(it|test|describe)\s*\.\s*skip\s*\(/g) ?? []).length
    const todos = (content.match(/\b(it|test)\s*\.\s*todo\s*\(/g) ?? []).length
    const total = cases + todos
    if (total === 0) continue
    suites.push({
      id: `suite-${suites.length + 1}`,
      name: f.rel.split("/").pop() ?? f.rel,
      filePath: f.rel,
      total,
      passed: 0, // unknown without running
      failed: 0,
      skipped: skipped + todos,
      durationMs: 0,
      status: "skipped",
    })

    // Slow/large test file heuristic.
    if (cases > 40) {
      findings.push(tf(`test-large-${suites.length}`, "slow", "low", `Large test file (${cases} cases)`, "Very large test files are slow to run and hard to maintain.", f.rel, "Split into focused suites."))
    }
  }

  // Coverage (from existing report only — we don't run the suite here).
  const cov = await readCoverage(ctx.root)
  const coverage = cov?.totals ?? { lines: 0, functions: 0, branches: 0, statements: 0 }
  const files = cov?.files ?? []

  // --- Findings -----------------------------------------------------------
  if (framework === "none") {
    findings.push(tf("test-none", "no-tests", "high", "No test framework detected", "The project has no test runner configured, so regressions can ship undetected.", "package.json", "Add Vitest or Jest and start with smoke tests for critical paths."))
  } else if (testFiles.length === 0) {
    findings.push(tf("test-empty", "no-tests", "high", `${framework} installed but no test files found`, "A test runner is present but there are no test files.", "—", "Add *.test.ts / *.spec.ts files covering core logic."))
  }

  // Source files without a colocated test (sample, top by likely importance).
  if (framework !== "none") {
    const sourceFiles = ctx.codeFiles((rel) => !/(test|spec)\./.test(rel) && !/\.d\.ts$/.test(rel) && /(lib|src|app|components|server|utils)\//.test(rel))
    const tested = new Set(testFiles.map((f) => f.rel.replace(/\.(test|spec)\./, ".")))
    const uncovered = sourceFiles.filter((f) => !tested.has(f.rel)).slice(0, 0) // informational only; avoid noise
    void uncovered
  }

  if (cov && coverage.lines < 60) {
    findings.push(tf("test-lowcov", "uncovered", coverage.lines < 30 ? "high" : "medium", `Line coverage is ${coverage.lines}%`, "Coverage is below a healthy threshold; large parts of the code are untested.", "coverage", "Add tests to raise line coverage above 70%."))
  }

  const counts = {
    total: suites.reduce((s, x) => s + x.total, 0),
    passed: suites.reduce((s, x) => s + x.passed, 0),
    failed: suites.reduce((s, x) => s + x.failed, 0),
    skipped: suites.reduce((s, x) => s + x.skipped, 0),
    suites: suites.length,
    durationMs: suites.reduce((s, x) => s + x.durationMs, 0),
  }

  return { framework, coverage, suites, findings, files, counts }
}

function tf(
  id: string,
  kind: TestFinding["kind"],
  severity: Severity,
  title: string,
  detail: string,
  filePath: string,
  recommendation: string,
): TestFinding {
  return { id, kind, severity, title, detail, filePath, recommendation }
}
