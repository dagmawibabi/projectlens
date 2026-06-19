import { countLoc, type ScanContext } from "./scan.js"
import type { SetupResult, ConfigEntry, WorkspaceStats, LanguageStat } from "../types.js"

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".css": "CSS",
  ".scss": "CSS",
  ".json": "JSON",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".yml": "YAML",
  ".yaml": "YAML",
}

/** Config files we recognize, with how to summarize them. */
const CONFIG_DEFS: Array<{
  id: string
  name: string
  files: string[]
  tool: string
}> = [
  { id: "ts", name: "TypeScript", files: ["tsconfig.json"], tool: "tsc" },
  { id: "eslint", name: "ESLint", files: ["eslint.config.js", "eslint.config.mjs", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs"], tool: "ESLint" },
  { id: "prettier", name: "Prettier", files: [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js", ".prettierrc.cjs"], tool: "Prettier" },
  { id: "tailwind", name: "Tailwind CSS", files: ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs"], tool: "Tailwind" },
  { id: "next", name: "Next.js", files: ["next.config.js", "next.config.mjs", "next.config.ts"], tool: "Next.js" },
  { id: "vite", name: "Vite", files: ["vite.config.js", "vite.config.ts"], tool: "Vite" },
  { id: "postcss", name: "PostCSS", files: ["postcss.config.js", "postcss.config.mjs", "postcss.config.cjs"], tool: "PostCSS" },
  { id: "vitest", name: "Vitest", files: ["vitest.config.ts", "vitest.config.js"], tool: "Vitest" },
  { id: "jest", name: "Jest", files: ["jest.config.js", "jest.config.ts", "jest.config.mjs"], tool: "Jest" },
  { id: "docker", name: "Docker", files: ["Dockerfile", "docker-compose.yml", "compose.yaml"], tool: "Docker" },
  { id: "editorconfig", name: "EditorConfig", files: [".editorconfig"], tool: "EditorConfig" },
]

function isComponentFile(rel: string, content: string): boolean {
  if (!/\.(tsx|jsx|vue|svelte)$/.test(rel)) return false
  if (rel.endsWith(".vue") || rel.endsWith(".svelte")) return true
  // Heuristic: exports a function/const returning JSX.
  return /export\s+(default\s+)?(function|const)\s+[A-Z]/.test(content) || /return\s*\(/.test(content)
}

function isRouteFile(rel: string): boolean {
  // Next.js app router + pages router, plus common API route conventions.
  return (
    /(^|\/)app\/.*\/(page|route|layout)\.(t|j)sx?$/.test(rel) ||
    /(^|\/)pages\/.*\.(t|j)sx?$/.test(rel) ||
    /(^|\/)src\/(routes|pages)\//.test(rel)
  )
}

export async function collectSetup(ctx: ScanContext): Promise<SetupResult> {
  // --- Config detection ---------------------------------------------------
  const configs: ConfigEntry[] = []
  for (const def of CONFIG_DEFS) {
    const found = def.files.find((f) => ctx.files.some((sf) => sf.rel === f))
    if (!found) {
      configs.push({
        id: def.id,
        name: def.name,
        file: def.files[0],
        present: false,
        tool: def.tool,
        summary: `No ${def.name} configuration detected.`,
      })
      continue
    }
    const body = (await ctx.read(found)) ?? ""
    configs.push({
      id: def.id,
      name: def.name,
      file: found,
      present: true,
      tool: def.tool,
      summary: summarize(def.id, body),
      highlights: highlightsFor(def.id, body),
      ruleCount: ruleCountFor(def.id, body),
    })
  }

  // --- Workspace stats ----------------------------------------------------
  const langTotals = new Map<string, { files: number; loc: number }>()
  let totalLoc = 0
  let codeLoc = 0
  let commentLoc = 0
  let blankLoc = 0
  let testFiles = 0
  let testLoc = 0
  let components = 0
  let routes = 0
  let todoCount = 0
  const fileLocs: { path: string; loc: number }[] = []

  for (const file of ctx.files) {
    const lang = LANG_BY_EXT[file.ext]
    if (!lang) continue
    const content = await ctx.read(file.rel)
    if (content == null) continue
    const loc = countLoc(content)

    const entry = langTotals.get(lang) ?? { files: 0, loc: 0 }
    entry.files++
    entry.loc += loc.total
    langTotals.set(lang, entry)

    if (file.isCode) {
      totalLoc += loc.total
      codeLoc += loc.code
      commentLoc += loc.comment
      blankLoc += loc.blank
      fileLocs.push({ path: file.rel, loc: loc.total })
      todoCount += (content.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length
      if (file.isTest) {
        testFiles++
        testLoc += loc.total
      }
      if (isComponentFile(file.rel, content)) components++
      if (isRouteFile(file.rel)) routes++
    }
  }

  const totalFiles = ctx.files.length
  const languages: LanguageStat[] = [...langTotals.entries()]
    .map(([language, v]) => ({ language, files: v.files, loc: v.loc, share: 0 }))
    .sort((a, b) => b.loc - a.loc)
  const langLocSum = languages.reduce((s, l) => s + l.loc, 0) || 1
  for (const l of languages) l.share = Math.round((l.loc / langLocSum) * 1000) / 10

  const stats: WorkspaceStats = {
    totalFiles,
    totalLoc,
    codeLoc,
    commentLoc,
    blankLoc,
    testFiles,
    testLoc,
    components,
    routes,
    largestFiles: fileLocs.sort((a, b) => b.loc - a.loc).slice(0, 8),
    languages,
    commentRatio: codeLoc > 0 ? Math.round((commentLoc / (codeLoc + commentLoc)) * 1000) / 10 : 0,
    testRatio: codeLoc > 0 ? Math.round((testLoc / codeLoc) * 1000) / 10 : 0,
    todoCount,
  }

  // --- Tooling presence ---------------------------------------------------
  const tooling = [
    { name: "TypeScript", dep: "typescript" },
    { name: "ESLint", dep: "eslint" },
    { name: "Prettier", dep: "prettier" },
    { name: "Tailwind CSS", dep: "tailwindcss" },
    { name: "Husky", dep: "husky" },
    { name: "Vitest", dep: "vitest" },
    { name: "Jest", dep: "jest" },
    { name: "Playwright", dep: "@playwright/test" },
  ].map((t) => ({
    name: t.name,
    version: ctx.deps[t.dep]?.replace(/^[\^~]/, ""),
    detected: ctx.hasDep(t.dep),
  }))

  return { configs, stats, tooling }
}

function summarize(id: string, body: string): string {
  switch (id) {
    case "ts": {
      const strict = /"strict"\s*:\s*true/.test(body)
      const target = body.match(/"target"\s*:\s*"([^"]+)"/)?.[1]
      return `${strict ? "Strict mode on" : "Strict mode OFF"}${target ? `, target ${target}` : ""}.`
    }
    case "eslint":
      return "ESLint configured for the project."
    case "tailwind":
      return "Tailwind CSS configured."
    case "next":
      return "Next.js configuration present."
    default:
      return "Configured."
  }
}

function highlightsFor(id: string, body: string): ConfigEntry["highlights"] {
  if (id === "ts") {
    const flag = (name: string) => new RegExp(`"${name}"\\s*:\\s*true`).test(body)
    return [
      { label: "strict", value: flag("strict") ? "true" : "false", good: flag("strict") },
      { label: "noUncheckedIndexedAccess", value: flag("noUncheckedIndexedAccess") ? "true" : "false", good: flag("noUncheckedIndexedAccess") },
      { label: "skipLibCheck", value: flag("skipLibCheck") ? "true" : "false" },
    ]
  }
  return undefined
}

function ruleCountFor(id: string, body: string): number | undefined {
  if (id === "eslint") {
    const rulesBlock = body.match(/rules\s*[:=]\s*\{([\s\S]*?)\}/)?.[1]
    if (!rulesBlock) return undefined
    return (rulesBlock.match(/['"][\w@/-]+['"]\s*:/g) ?? []).length
  }
  return undefined
}
