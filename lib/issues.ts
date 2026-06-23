import type {
  LintMessage,
  TypeDiagnostic,
  SecurityFinding,
  DependencyFinding,
  Severity,
} from "./schema"
import type {
  EnvVariable,
  NetworkCall,
  GitIssue,
  DbFinding,
  A11yViolation,
  PerfFinding,
  TestFinding,
  StorageEntry,
} from "./project-insights"

export type IssueSource =
  | "lint"
  | "types"
  | "security"
  | "deps"
  | "env"
  | "network"
  | "git"
  | "database"
  | "a11y"
  | "perf"
  | "tests"
  | "storage"

/** A normalized issue used by the shared detail sheet. */
export interface Issue {
  source: IssueSource
  severity: Severity
  title: string
  filePath: string
  line: number
  column?: number
  endLine?: number
  ruleId?: string | null
  code?: string
  category?: string
  confidence?: number
  fixable?: boolean
  description: string
  recommendation?: string
  suggestedFix?: string
  related?: { message: string; depth: number }[]
  snippet?: { startLine: number; code: string }
  /** Primary external reference label + url. */
  reference?: string
  /** CVE identifiers (security + deps). */
  cves?: string[]
  /** Dependency-specific metadata, present when source === "deps". */
  dep?: {
    name: string
    current: string
    latest?: string
    fixedIn?: string
    type: string
    kind: string
    license?: string
    usedIn?: string[]
  }
  /** Environment-variable metadata, present when source === "env". */
  env?: {
    key: string
    scope: string
    status: string
    usedIn: string[]
    definedIn: string[]
    sample?: string
  }
  /** Network-call metadata, present when source === "network". */
  net?: {
    url: string
    host: string
    method: string
    client: string
    secure: boolean
    external: boolean
    issues: { kind: string; severity: Severity; message: string }[]
  }
  /** Database-finding metadata, present when source === "database". */
  db?: {
    engine: string
    kind: string
    target?: string
  }
  /** Accessibility-violation metadata, present when source === "a11y". */
  a11y?: {
    rule: string
    impact: string
    principle: string
    wcag: string[]
    helpUrl: string
    selector: string
    nodes: number
  }
  /** Performance-finding metadata, present when source === "perf". */
  perf?: {
    kind: string
    estimatedSavingKb?: number
  }
  /** Test-finding metadata, present when source === "tests". */
  test?: {
    kind: string
  }
  /** Storage-entry metadata, present when source === "storage". */
  storage?: {
    path: string
    kind: string
    sizeBytes: number
    sizeLabel: string
  }
}

export interface DocLink {
  label: string
  href: string
  /** Short provenance label, e.g. "ESLint", "OWASP". */
  kind: string
}

/* ------------------------------------------------------------------ */
/* Converters                                                          */
/* ------------------------------------------------------------------ */

export function lintToIssue(m: LintMessage): Issue {
  return {
    source: "lint",
    severity: m.severity,
    title: m.message,
    filePath: m.filePath,
    line: m.line,
    column: m.column,
    endLine: m.endLine,
    ruleId: m.ruleId,
    fixable: m.fixable,
    description: m.message,
    snippet: m.snippet,
  }
}

export function typeToIssue(d: TypeDiagnostic): Issue {
  return {
    source: "types",
    severity: "error",
    title: d.message,
    filePath: d.filePath,
    line: d.line,
    column: d.column,
    code: d.code,
    description: d.message,
    related: d.related,
  }
}

export function securityToIssue(f: SecurityFinding): Issue {
  return {
    source: "security",
    severity: f.severity,
    title: f.title,
    filePath: f.filePath,
    line: f.line,
    endLine: f.endLine,
    category: f.category,
    confidence: f.confidence,
    description: f.description,
    recommendation: f.recommendation,
    suggestedFix: f.suggestedFix,
    snippet: f.snippet,
    reference: f.reference,
  }
}

export function depToIssue(d: DependencyFinding): Issue {
  return {
    source: "deps",
    severity: d.severity,
    title: d.title,
    filePath: "package.json",
    line: 1,
    category: d.kind,
    description: d.detail,
    recommendation: d.recommendation,
    reference: d.reference,
    cves: d.cves,
    dep: {
      name: d.name,
      current: d.current,
      latest: d.latest,
      fixedIn: d.fixedIn,
      type: d.type,
      kind: d.kind,
      license: d.license,
      usedIn: d.usedIn,
    },
  }
}

const ENV_STATUS_TITLE: Record<string, string> = {
  ok: "Configured correctly",
  missing: "Referenced but never defined",
  undocumented: "Missing from .env.example",
  unused: "Defined but never used",
  exposed: "Secret reachable from the client bundle",
  empty: "Defined with an empty value",
}

export function envToIssue(v: EnvVariable): Issue {
  return {
    source: "env",
    severity: v.severity,
    title: `${v.key} — ${ENV_STATUS_TITLE[v.status] ?? v.status}`,
    filePath: v.usedIn[0] ?? v.definedIn[0] ?? ".env.local",
    line: 1,
    category: v.status,
    description: v.note,
    recommendation:
      v.status === "exposed"
        ? "Move this read into a Server Component, Route Handler, or Server Action. Never reference a non-NEXT_PUBLIC secret from client code."
        : v.status === "missing"
          ? "Add the variable to .env.local (and .env.example) before it is read at runtime."
          : v.status === "undocumented"
            ? "Add the key with a placeholder value and a comment to .env.example."
            : v.status === "unused"
              ? "Remove the unused variable to reduce confusion and attack surface."
              : v.status === "empty"
                ? "Provide a real value or guard the code path that reads it."
                : undefined,
    env: { key: v.key, scope: v.scope, status: v.status, usedIn: v.usedIn, definedIn: v.definedIn, sample: v.sample },
  }
}

export function networkToIssue(c: NetworkCall): Issue {
  const top = [...c.issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]
  return {
    source: "network",
    severity: top?.severity ?? "info",
    title: top ? top.message : `${c.method} ${c.host}`,
    filePath: c.filePath,
    line: c.line,
    category: c.client,
    description:
      `${c.method} request to ${c.url} via ${c.client}.` +
      (c.issues.length ? ` ${c.issues.length} issue${c.issues.length === 1 ? "" : "s"} detected.` : " No issues detected."),
    recommendation: c.issues.map((i) => i.message).join(" "),
    net: { url: c.url, host: c.host, method: c.method, client: c.client, secure: c.secure, external: c.external, issues: c.issues },
  }
}

export function dbToIssue(f: DbFinding): Issue {
  return {
    source: "database",
    severity: f.severity,
    title: f.title,
    filePath: f.filePath,
    line: f.line ?? 1,
    category: f.kind,
    description: f.detail,
    recommendation: f.recommendation,
    snippet: f.snippet,
    db: { engine: f.engine, kind: f.kind, target: f.target },
  }
}

export function gitToIssue(g: GitIssue): Issue {
  return {
    source: "git",
    severity: g.severity,
    title: g.title,
    filePath: g.filePath ?? ".git",
    line: 1,
    category: g.kind,
    description: g.detail,
    recommendation: g.recommendation,
  }
}

const A11Y_IMPACT_SEVERITY: Record<string, Severity> = {
  critical: "critical",
  serious: "high",
  moderate: "medium",
  minor: "low",
}

export function a11yToIssue(v: A11yViolation): Issue {
  return {
    source: "a11y",
    severity: A11Y_IMPACT_SEVERITY[v.impact] ?? "medium",
    title: v.help,
    filePath: v.filePath,
    line: v.line,
    category: v.rule,
    description: `${v.description}. ${v.nodes} ${v.nodes === 1 ? "element is" : "elements are"} affected (${v.selector}).`,
    recommendation: v.recommendation,
    snippet: v.snippet,
    a11y: {
      rule: v.rule,
      impact: v.impact,
      principle: v.principle,
      wcag: v.wcag,
      helpUrl: v.helpUrl,
      selector: v.selector,
      nodes: v.nodes,
    },
  }
}

export function perfToIssue(f: PerfFinding): Issue {
  return {
    source: "perf",
    severity: f.severity,
    title: f.title,
    filePath: f.filePath,
    line: f.line ?? 1,
    category: f.kind,
    description: f.detail,
    recommendation: f.recommendation,
    snippet: f.snippet,
    perf: { kind: f.kind, estimatedSavingKb: f.estimatedSavingKb },
  }
}

export function testToIssue(f: TestFinding): Issue {
  return {
    source: "tests",
    severity: f.severity,
    title: f.title,
    filePath: f.filePath,
    line: f.line ?? 1,
    category: f.kind,
    description: f.detail,
    recommendation: f.recommendation,
    snippet: f.snippet,
    test: { kind: f.kind },
  }
}

const STORAGE_KIND_LABEL: Record<string, string> = {
  node_modules: "Dependencies",
  build: "Build output",
  cache: "Cache",
  coverage: "Coverage",
  other: "Other",
}

export function storageToIssue(e: StorageEntry): Issue {
  const sev: Severity = e.sizeBytes > 500_000_000 ? "high" : e.sizeBytes > 100_000_000 ? "medium" : "low"
  return {
    source: "storage",
    severity: sev,
    title: `${e.path} — ${e.sizeLabel}`,
    filePath: e.path,
    line: 1,
    category: e.kind,
    description: `${STORAGE_KIND_LABEL[e.kind] ?? e.kind} directory consuming ${e.sizeLabel}. Last modified ${e.lastModifiedRelative}.`,
    recommendation: e.safeToDelete
      ? `Safe to delete. ${e.kind === "node_modules" ? "Run your package manager's install command to restore." : "Rebuild to regenerate."}`
      : undefined,
    storage: { path: e.path, kind: e.kind, sizeBytes: e.sizeBytes, sizeLabel: e.sizeLabel },
  }
}

function severityRank(s: Severity): number {
  return { critical: 6, error: 5, high: 4, warning: 3, medium: 3, low: 2, info: 1 }[s] ?? 1
}

/* ------------------------------------------------------------------ */
/* Curated documentation + resource links                             */
/* ------------------------------------------------------------------ */

function lintRuleDoc(ruleId: string): DocLink | null {
  if (ruleId.startsWith("@typescript-eslint/")) {
    return {
      label: `typescript-eslint: ${ruleId}`,
      href: `https://typescript-eslint.io/rules/${ruleId.replace("@typescript-eslint/", "")}/`,
      kind: "typescript-eslint",
    }
  }
  if (ruleId.startsWith("react-hooks/")) {
    return { label: "React: Rules of Hooks", href: "https://react.dev/reference/rules/rules-of-hooks", kind: "React" }
  }
  if (ruleId.startsWith("jsx-a11y/")) {
    return {
      label: `eslint-plugin-jsx-a11y: ${ruleId}`,
      href: `https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/docs/rules/${ruleId.replace("jsx-a11y/", "")}.md`,
      kind: "a11y",
    }
  }
  if (ruleId.startsWith("import/")) {
    return {
      label: `eslint-plugin-import: ${ruleId}`,
      href: `https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/${ruleId.replace("import/", "")}.md`,
      kind: "import",
    }
  }
  // Core ESLint rule
  return { label: `ESLint: ${ruleId}`, href: `https://eslint.org/docs/latest/rules/${ruleId}`, kind: "ESLint" }
}

const SECURITY_RESOURCES: Record<string, DocLink[]> = {
  injection: [
    { label: "OWASP: SQL Injection Prevention", href: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html", kind: "OWASP" },
    { label: "PortSwigger: SQL injection", href: "https://portswigger.net/web-security/sql-injection", kind: "PortSwigger" },
  ],
  xss: [
    { label: "OWASP: XSS Prevention", href: "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html", kind: "OWASP" },
    { label: "React: dangerouslySetInnerHTML", href: "https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html", kind: "React" },
  ],
  auth: [
    { label: "OWASP: Authorization Cheat Sheet", href: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html", kind: "OWASP" },
    { label: "OWASP: Broken Access Control", href: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/", kind: "OWASP" },
  ],
  secrets: [
    { label: "OWASP: Secrets Management", href: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html", kind: "OWASP" },
    { label: "Next.js: Environment Variables", href: "https://nextjs.org/docs/app/building-your-application/configuring/environment-variables", kind: "Next.js" },
  ],
  crypto: [
    { label: "OWASP: Cryptographic Storage", href: "https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html", kind: "OWASP" },
    { label: "Node.js: crypto.randomBytes", href: "https://nodejs.org/api/crypto.html#cryptorandombytessize-callback", kind: "Node.js" },
  ],
  ssrf: [
    { label: "OWASP: SSRF Prevention", href: "https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html", kind: "OWASP" },
  ],
  config: [{ label: "OWASP: Security Misconfiguration", href: "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/", kind: "OWASP" }],
  "data-exposure": [{ label: "OWASP: Sensitive Data Exposure", href: "https://owasp.org/www-project-top-ten/2017/A3_2017-Sensitive_Data_Exposure", kind: "OWASP" }],
  other: [{ label: "OWASP Top 10", href: "https://owasp.org/www-project-top-ten/", kind: "OWASP" }],
}

/** Returns curated documentation/resource links for an issue. */
export function issueDocs(issue: Issue): DocLink[] {
  const links: DocLink[] = []

  if (issue.source === "lint" && issue.ruleId) {
    const d = lintRuleDoc(issue.ruleId)
    if (d) links.push(d)
  }

  if (issue.source === "types" && issue.code) {
    links.push(
      { label: `Explained: ${issue.code}`, href: `https://typescript.tv/errors/#${issue.code}`, kind: "typescript.tv" },
      { label: "TypeScript Handbook", href: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html", kind: "TypeScript" },
    )
  }

  if (issue.source === "security") {
    if (issue.reference?.startsWith("CWE-")) {
      links.push({
        label: issue.reference,
        href: `https://cwe.mitre.org/data/definitions/${issue.reference.replace("CWE-", "")}.html`,
        kind: "MITRE CWE",
      })
    }
    if (issue.category && SECURITY_RESOURCES[issue.category]) {
      links.push(...SECURITY_RESOURCES[issue.category])
    }
  }

  // Per-CVE links to the National Vulnerability Database.
  for (const cve of issue.cves ?? []) {
    links.push({ label: cve, href: `https://nvd.nist.gov/vuln/detail/${cve}`, kind: "NVD" })
  }

  if (issue.source === "deps" && issue.dep) {
    const { name } = issue.dep
    const enc = encodeURIComponent(name)
    if (issue.reference) {
      links.push({ label: "Primary advisory", href: issue.reference, kind: "Advisory" })
    }
    links.push(
      { label: `npm: ${name}`, href: `https://www.npmjs.com/package/${enc}`, kind: "npm" },
      { label: `Snyk vulnerability DB`, href: `https://security.snyk.io/package/npm/${enc}`, kind: "Snyk" },
      { label: `GitHub Advisories`, href: `https://github.com/advisories?query=${enc}`, kind: "GitHub" },
      { label: `Socket.dev supply-chain report`, href: `https://socket.dev/npm/package/${enc}`, kind: "Socket" },
      { label: `deps.dev dependency graph`, href: `https://deps.dev/npm/${enc}`, kind: "deps.dev" },
    )
    if (issue.dep.kind === "license") {
      links.push({ label: "SPDX license list", href: "https://spdx.org/licenses/", kind: "SPDX" })
    }
  }

  if (issue.source === "env") {
    links.push(
      { label: "Next.js: Environment Variables", href: "https://nextjs.org/docs/app/building-your-application/configuring/environment-variables", kind: "Next.js" },
      { label: "OWASP: Secrets Management", href: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html", kind: "OWASP" },
    )
    if (issue.env?.status === "exposed") {
      links.push({ label: "Next.js: Keeping Server-Only Code", href: "https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#keeping-server-only-code-out-of-the-client-environment", kind: "Next.js" })
    }
  }

  if (issue.source === "network") {
    links.push(
      { label: "MDN: Using the Fetch API", href: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch", kind: "MDN" },
      { label: "MDN: AbortController (timeouts)", href: "https://developer.mozilla.org/en-US/docs/Web/API/AbortController", kind: "MDN" },
    )
    if (issue.net && !issue.net.secure) {
      links.push({ label: "MDN: Mixed content", href: "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content", kind: "MDN" })
    }
  }

  if (issue.source === "database") {
    const engine = issue.db?.engine
    if (engine === "mongodb") {
      links.push(
        { label: "MongoDB: Indexing Strategies", href: "https://www.mongodb.com/docs/manual/applications/indexes/", kind: "MongoDB" },
        { label: "MongoDB: Query Optimization", href: "https://www.mongodb.com/docs/manual/core/query-optimization/", kind: "MongoDB" },
        { label: "Mongoose: Connections", href: "https://mongoosejs.com/docs/connections.html", kind: "Mongoose" },
      )
    } else if (engine === "redis") {
      links.push(
        { label: "Redis: Key expiration (TTL)", href: "https://redis.io/docs/latest/develop/use/keyspace/#key-expiration", kind: "Redis" },
        { label: "Redis: TLS support", href: "https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/", kind: "Redis" },
      )
    } else {
      links.push(
        { label: "PostgreSQL: Using EXPLAIN", href: "https://www.postgresql.org/docs/current/using-explain.html", kind: "PostgreSQL" },
        { label: "PostgreSQL: Indexes", href: "https://www.postgresql.org/docs/current/indexes.html", kind: "PostgreSQL" },
      )
    }
    if (issue.db?.kind === "injection") {
      links.push({ label: "OWASP: SQL Injection Prevention", href: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html", kind: "OWASP" })
    }
    if (issue.db?.kind === "n+1") {
      links.push({ label: "The N+1 query problem", href: "https://planetscale.com/blog/what-is-n-1-query-problem-and-how-to-solve-it", kind: "PlanetScale" })
    }
  }

  if (issue.source === "git") {
    links.push(
      { label: "GitHub: Removing sensitive data", href: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository", kind: "GitHub" },
      { label: "GitHub Actions: Security hardening", href: "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions", kind: "GitHub" },
    )
    if (issue.category === "large-file") {
      links.push({ label: "Git LFS", href: "https://git-lfs.com/", kind: "Git LFS" })
    }
  }

  if (issue.source === "a11y" && issue.a11y) {
    links.push(
      { label: `axe: ${issue.a11y.rule}`, href: issue.a11y.helpUrl, kind: "Deque" },
      { label: "WAI-ARIA Authoring Practices", href: "https://www.w3.org/WAI/ARIA/apg/", kind: "W3C" },
      { label: "MDN: Accessibility", href: "https://developer.mozilla.org/en-US/docs/Web/Accessibility", kind: "MDN" },
    )
    // Link directly to the relevant WCAG success criterion when we have one.
    const sc = issue.a11y.wcag.find((w) => /^\d/.test(w))
    if (sc) {
      links.push({
        label: `WCAG ${sc}`,
        href: `https://www.w3.org/WAI/WCAG21/Understanding/${sc.replace(/\./g, "")}`,
        kind: "WCAG",
      })
    }
  }

  if (issue.source === "perf") {
    links.push(
      { label: "web.dev: Core Web Vitals", href: "https://web.dev/articles/vitals", kind: "web.dev" },
      { label: "Next.js: Optimizing", href: "https://nextjs.org/docs/app/building-your-application/optimizing", kind: "Next.js" },
    )
    if (issue.perf?.kind === "unoptimized-image") {
      links.push({ label: "next/image", href: "https://nextjs.org/docs/app/api-reference/components/image", kind: "Next.js" })
    }
    if (issue.perf?.kind === "large-dependency" || issue.perf?.kind === "duplicate-dependency") {
      links.push({ label: "Bundlephobia", href: "https://bundlephobia.com/", kind: "Bundlephobia" })
    }
    if (issue.perf?.kind === "layout-shift") {
      links.push({ label: "web.dev: Optimize CLS", href: "https://web.dev/articles/optimize-cls", kind: "web.dev" })
    }
    if (issue.perf?.kind === "render-blocking" || issue.perf?.kind === "sync-script") {
      links.push({ label: "next/script", href: "https://nextjs.org/docs/app/api-reference/components/script", kind: "Next.js" })
    }
    if (issue.perf?.kind === "no-code-split" || issue.perf?.kind === "no-memo") {
      links.push({ label: "React: lazy & Suspense", href: "https://react.dev/reference/react/lazy", kind: "React" })
    }
  }

  if (issue.source === "tests") {
    links.push(
      { label: "Vitest docs", href: "https://vitest.dev/guide/", kind: "Vitest" },
      { label: "Testing Library queries", href: "https://testing-library.com/docs/queries/about/", kind: "Testing Library" },
    )
    if (issue.test?.kind === "flaky") {
      links.push({ label: "Vitest: async & timers", href: "https://vitest.dev/guide/mocking.html#timers", kind: "Vitest" })
    }
    if (issue.test?.kind === "uncovered" || issue.test?.kind === "no-tests") {
      links.push({ label: "Vitest: coverage", href: "https://vitest.dev/guide/coverage.html", kind: "Vitest" })
    }
  }

  return links
}

/* ------------------------------------------------------------------ */
/* Editor deep-links                                                   */
/* ------------------------------------------------------------------ */

export interface EditorTarget {
  id: string
  label: string
  /** Builds a deep-link URL for the given absolute path + position. */
  url: (absPath: string, line: number, col: number) => string
}

export const EDITORS: EditorTarget[] = [
  { id: "vscode", label: "VS Code", url: (p, l, c) => `vscode://file/${p}:${l}:${c}` },
  { id: "cursor", label: "Cursor", url: (p, l, c) => `cursor://file/${p}:${l}:${c}` },
  { id: "windsurf", label: "Windsurf", url: (p, l, c) => `windsurf://file/${p}:${l}:${c}` },
  { id: "vscode-insiders", label: "VS Code Insiders", url: (p, l, c) => `vscode-insiders://file/${p}:${l}:${c}` },
  { id: "webstorm", label: "WebStorm", url: (p, l) => `webstorm://open?file=${encodeURIComponent(p)}&line=${l}` },
  { id: "zed", label: "Zed", url: (p, l, c) => `zed://file/${p}:${l}:${c}` },
]

/** Joins a project root and a relative path into an absolute path. */
export function absolutePath(root: string, relPath: string): string {
  if (relPath.startsWith("/")) return relPath
  return `${root.replace(/\/$/, "")}/${relPath}`
}
