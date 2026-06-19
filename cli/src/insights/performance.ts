import { promises as fs } from "node:fs"
import path from "node:path"
import { snippetAround, type ScanContext } from "./scan.js"
import type { PerfResult, PerfFinding, WebVital, BundleRoute, Severity } from "../types.js"

/** Dependencies known to be heavy; used for large-dependency findings. */
const HEAVY_DEPS: Record<string, number> = {
  moment: 290,
  lodash: 70,
  "moment-timezone": 180,
  rxjs: 200,
  "chart.js": 240,
  "@mui/material": 350,
  three: 600,
  "pdfjs-dist": 400,
  "monaco-editor": 900,
  "@ffmpeg/ffmpeg": 800,
}

async function dirSizeKb(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) total += await dirSizeKb(p)
      else {
        try {
          total += (await fs.stat(p)).size
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return total / 1024
}

export async function collectPerformance(ctx: ScanContext): Promise<PerfResult> {
  const findings: PerfFinding[] = []
  let id = 0

  // --- Static code heuristics --------------------------------------------
  let usesNextImage = false
  for (const file of ctx.codeFiles((rel) => /\.(tsx|jsx|vue|svelte|html)$/.test(rel))) {
    const content = await ctx.read(file.rel)
    if (!content) continue
    if (/from\s+["']next\/image["']/.test(content)) usesNextImage = true
    const lines = content.split("\n")

    lines.forEach((line, idx) => {
      const lineNo = idx + 1
      // Raw <img> in a Next.js project.
      if (/<img\b/.test(line) && ctx.hasDep("next")) {
        findings.push(perf(`perf-img-${++id}`, "unoptimized-image", "medium", "Unoptimized <img> tag", "Using a raw <img> in a Next.js app skips automatic image optimization.", file.rel, lineNo, "Use next/image for automatic resizing, lazy-loading, and modern formats.", 40, snippetAround(content, lineNo)))
      }
      // Synchronous script tag.
      if (/<script\b(?![^>]*\b(async|defer)\b)[^>]*\bsrc=/.test(line)) {
        findings.push(perf(`perf-script-${++id}`, "sync-script", "medium", "Render-blocking script", "A synchronous <script src> blocks rendering until it loads.", file.rel, lineNo, "Add async or defer to the script tag.", 0, snippetAround(content, lineNo)))
      }
    })
  }

  // --- Dependency-weight heuristics --------------------------------------
  for (const [dep, kb] of Object.entries(HEAVY_DEPS)) {
    if (ctx.hasDep(dep)) {
      findings.push(perf(`perf-dep-${++id}`, "large-dependency", kb > 300 ? "high" : "medium", `Heavy dependency: ${dep}`, `${dep} adds roughly ${kb}KB to the bundle.`, "package.json", undefined, suggestionFor(dep), kb))
    }
  }

  // Barrel/no code-split heuristic: many top-level imports in entry without dynamic().
  const usesDynamic = await anyFileMatches(ctx, /(import\(|next\/dynamic|React\.lazy|defineAsyncComponent)/)
  if (!usesDynamic && ctx.codeFiles().length > 60) {
    findings.push(perf(`perf-split-${++id}`, "no-code-split", "low", "No code-splitting detected", "The project doesn't appear to use dynamic imports, so all code may ship in one chunk.", "—", undefined, "Lazy-load heavy routes/components with dynamic import().", 0))
  }

  // --- Bundle estimate ----------------------------------------------------
  const bundles: BundleRoute[] = []
  let totalBundleKb = 0
  // If a build output exists, sample its size; otherwise estimate from deps.
  for (const outDir of [".next/static", "dist/assets", "build/static", "out/_next"]) {
    const abs = path.join(ctx.root, outDir)
    const kb = await dirSizeKb(abs)
    if (kb > 0) {
      totalBundleKb = Math.round(kb)
      break
    }
  }
  if (totalBundleKb === 0) {
    // Estimate from dependency count + heavy deps.
    const depCount = Object.keys(ctx.deps).length
    totalBundleKb = Math.round(120 + depCount * 6 + Object.entries(HEAVY_DEPS).reduce((s, [d, kb]) => s + (ctx.hasDep(d) ? kb : 0), 0))
  }

  // Score: start at 100, subtract per finding by severity, plus bundle penalty.
  const penalty = findings.reduce((s, f) => s + sevWeight(f.severity), 0)
  const bundlePenalty = totalBundleKb > 500 ? Math.min(25, Math.round((totalBundleKb - 500) / 80)) : 0
  const score = Math.max(0, Math.min(100, 100 - penalty - bundlePenalty + (usesNextImage ? 3 : 0)))

  // Vitals require runtime measurement — reported empty in static mode.
  const vitals: WebVital[] = []

  return {
    score,
    vitals,
    bundles,
    findings: findings.sort((a, b) => sevWeight(b.severity) - sevWeight(a.severity)),
    totalBundleKb,
    counts: { findings: findings.length },
  }
}

async function anyFileMatches(ctx: ScanContext, re: RegExp): Promise<boolean> {
  for (const f of ctx.codeFiles()) {
    const c = await ctx.read(f.rel)
    if (c && re.test(c)) return true
  }
  return false
}

function suggestionFor(dep: string): string {
  const map: Record<string, string> = {
    moment: "Replace moment with date-fns or day.js (far smaller and tree-shakeable).",
    "moment-timezone": "Use date-fns-tz or Intl.DateTimeFormat instead.",
    lodash: "Import individual functions (lodash-es) or use native methods.",
    three: "Lazy-load the 3D view and import only needed three modules.",
    "monaco-editor": "Lazy-load the editor and load it on demand.",
  }
  return map[dep] ?? `Consider a lighter alternative to ${dep} or load it lazily.`
}

function perf(
  id: string,
  kind: PerfFinding["kind"],
  severity: Severity,
  title: string,
  detail: string,
  filePath: string,
  line: number | undefined,
  recommendation: string,
  estimatedSavingKb?: number,
  snippet?: { startLine: number; code: string },
): PerfFinding {
  return { id, kind, severity, title, detail, filePath, line, recommendation, estimatedSavingKb, snippet }
}

function sevWeight(s: Severity): number {
  const order: Record<string, number> = { critical: 14, high: 9, error: 9, medium: 5, warning: 4, low: 2, info: 1 }
  return order[s] ?? 0
}
