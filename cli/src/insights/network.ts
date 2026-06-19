import type { ScanContext } from "./scan.js"
import type {
  NetworkResult,
  NetworkCall,
  NetworkIssue,
  NetworkClient,
  NetworkDomain,
} from "../types.js"

interface RawCall {
  file: string
  line: number
  method: string
  url: string
  client: NetworkClient
  context: string
}

const CLIENT_PATTERNS: Array<{ client: NetworkClient; re: RegExp }> = [
  { client: "fetch", re: /\bfetch\s*\(/g },
  { client: "axios", re: /\baxios\s*(?:\.\s*(get|post|put|patch|delete|head|options))?\s*\(/gi },
  { client: "ky", re: /\bky\s*(?:\.\s*(get|post|put|patch|delete))?\s*\(/gi },
  { client: "xhr", re: /\bnew\s+XMLHttpRequest\s*\(/g },
  { client: "websocket", re: /\bnew\s+WebSocket\s*\(/g },
]

const URL_RE = /["'`](https?:\/\/[^"'`\s]+|wss?:\/\/[^"'`\s]+|\/[^"'`\s]*)["'`]/
const METHOD_RE = /method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/i

const CATEGORY_HINTS: Array<{ re: RegExp; category: NetworkDomain["category"] }> = [
  { re: /(stripe|paypal|braintree|checkout)/i, category: "payment" },
  { re: /(auth0|clerk|okta|cognito|firebaseauth|accounts\.google)/i, category: "auth" },
  { re: /(segment|mixpanel|amplitude|analytics|posthog|gtag|plausible)/i, category: "analytics" },
  { re: /(cdn|cloudfront|jsdelivr|unpkg|fastly|akamai|cloudflare)/i, category: "cdn" },
  { re: /(api\.|\/api|graphql)/i, category: "api" },
]

function categorize(host: string, url: string): NetworkDomain["category"] {
  if (host === "relative") return "internal"
  for (const { re, category } of CATEGORY_HINTS) {
    if (re.test(host) || re.test(url)) return category
  }
  return "other"
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "unknown"
  }
}

const RANK: Record<string, number> = { critical: 6, high: 5, error: 5, medium: 4, warning: 3, low: 2, info: 1 }
const rank = (s: NetworkIssue["severity"]): number => RANK[s] ?? 0
const maxRank = (issues: NetworkIssue[]): number => issues.reduce((a, i) => Math.max(a, rank(i.severity)), 0)

/**
 * Detects outbound HTTP/WS calls and common reliability/security smells around
 * them. Best-effort static analysis — reads a small window of source around
 * each call site rather than building a full AST.
 */
export async function collectNetwork(ctx: ScanContext): Promise<NetworkResult> {
  const raw: RawCall[] = []

  for (const file of ctx.codeFiles()) {
    const text = await ctx.read(file.rel)
    if (!text || !/fetch|axios|\bky\b|XMLHttpRequest|WebSocket/.test(text)) continue
    const lines = text.split("\n")

    for (const { client, re } of CLIENT_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const lineNo = text.slice(0, m.index).split("\n").length
        const windowStart = Math.max(0, lineNo - 1)
        const windowText = lines.slice(windowStart, Math.min(lines.length, lineNo + 6)).join("\n")

        const explicitMethod = m[1]?.toUpperCase()
        const method = explicitMethod || windowText.match(METHOD_RE)?.[1]?.toUpperCase() || (client === "websocket" ? "WS" : "GET")
        const url = windowText.match(URL_RE)?.[1] ?? "(dynamic)"

        raw.push({ file: file.rel, line: lineNo, method, url, client, context: windowText })
      }
    }
  }

  const calls: NetworkCall[] = raw.map((c, i) => {
    const issues: NetworkIssue[] = []
    const ctxText = c.context
    const isAbsolute = /^(https?|wss?):\/\//.test(c.url)
    const secure = c.url.startsWith("https://") || c.url.startsWith("wss://") || !isAbsolute
    const host = isAbsolute ? safeHost(c.url) : "relative"

    if (/^(http|ws):\/\//.test(c.url)) {
      issues.push({ kind: "insecure", severity: "high", message: "Uses insecure HTTP/WS instead of TLS." })
    }
    if (isAbsolute) {
      issues.push({ kind: "hardcoded-url", severity: "low", message: "Absolute URL hardcoded in source; consider an env var." })
    }
    if (!(/\.catch\s*\(/.test(ctxText) || /try\s*\{/.test(ctxText))) {
      issues.push({ kind: "no-error-handling", severity: "medium", message: "No try/catch or .catch() around the request." })
    }
    if (c.client === "fetch" && !/signal\s*:/.test(ctxText)) {
      issues.push({ kind: "no-timeout", severity: "medium", message: "No AbortSignal/timeout configured." })
    } else if ((c.client === "axios" || c.client === "ky") && !/timeout\s*:/.test(ctxText)) {
      issues.push({ kind: "no-timeout", severity: "low", message: "No timeout configured." })
    }
    if (/Authorization\s*:\s*["'`]Bearer\s+[A-Za-z0-9._-]{8,}["'`]/.test(ctxText) || /(api[_-]?key|token|secret)=[A-Za-z0-9]{8,}/i.test(c.url)) {
      issues.push({ kind: "no-auth", severity: "high", message: "Credentials appear hardcoded near the request." })
    }

    return {
      id: `net-${i + 1}`,
      method: c.method,
      url: c.url,
      host,
      external: isAbsolute,
      secure,
      client: c.client,
      filePath: c.file,
      line: c.line,
      issues,
    }
  })

  const domainMap = new Map<string, NetworkDomain>()
  for (const c of calls) {
    const existing = domainMap.get(c.host)
    if (existing) existing.calls++
    else domainMap.set(c.host, { host: c.host, calls: 1, external: c.external, category: categorize(c.host, c.url) })
  }

  return {
    calls: calls.sort((a, b) => maxRank(b.issues) - maxRank(a.issues)),
    domains: [...domainMap.values()].sort((a, b) => b.calls - a.calls),
    counts: {
      total: calls.length,
      external: calls.filter((c) => c.external).length,
      insecure: calls.filter((c) => c.issues.some((i) => i.kind === "insecure")).length,
      issues: calls.filter((c) => c.issues.length > 0).length,
    },
  }
}
