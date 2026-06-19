import { snippetAround, type ScanContext } from "./scan.js"
import type { DbResult, DbConnection, DbFinding, DbQuery, DbEngine, Severity } from "../types.js"

interface ClientDef {
  dep: string
  engine: DbEngine
  client: string
  pooled?: boolean
}

const CLIENTS: ClientDef[] = [
  { dep: "@neondatabase/serverless", engine: "postgres", client: "Neon", pooled: true },
  { dep: "pg", engine: "postgres", client: "node-postgres" },
  { dep: "postgres", engine: "postgres", client: "postgres.js" },
  { dep: "@vercel/postgres", engine: "postgres", client: "Vercel Postgres", pooled: true },
  { dep: "drizzle-orm", engine: "postgres", client: "Drizzle ORM" },
  { dep: "@prisma/client", engine: "postgres", client: "Prisma", pooled: true },
  { dep: "mysql2", engine: "mysql", client: "mysql2" },
  { dep: "mysql", engine: "mysql", client: "mysql" },
  { dep: "mongodb", engine: "mongodb", client: "MongoDB driver" },
  { dep: "mongoose", engine: "mongodb", client: "Mongoose" },
  { dep: "better-sqlite3", engine: "sqlite", client: "better-sqlite3" },
  { dep: "@libsql/client", engine: "sqlite", client: "libSQL/Turso", pooled: true },
  { dep: "ioredis", engine: "redis", client: "ioredis" },
  { dep: "redis", engine: "redis", client: "node-redis" },
  { dep: "@upstash/redis", engine: "redis", client: "Upstash Redis", pooled: true },
]

const DB_ENV_HINTS = /(DATABASE_URL|POSTGRES_URL|PG_|MYSQL_|MONGO_URL|MONGODB_URI|REDIS_URL|KV_URL|DB_)/i

export async function collectDatabase(ctx: ScanContext): Promise<DbResult> {
  const connections: DbConnection[] = []
  const findings: DbFinding[] = []
  const queries: DbQuery[] = []

  // --- Detect clients from dependencies ----------------------------------
  const detected = CLIENTS.filter((c) => ctx.hasDep(c.dep))

  // Find env var that likely holds the connection string.
  let connEnv = ""
  const envExample = (await ctx.read(".env.example")) ?? (await ctx.read(".env")) ?? ""
  connEnv = envExample.split("\n").map((l) => l.split("=")[0]?.trim()).find((k) => k && DB_ENV_HINTS.test(k)) ?? ""

  detected.forEach((c, i) => {
    connections.push({
      id: `db-${i + 1}`,
      engine: c.engine,
      name: c.client,
      client: c.client,
      host: connEnv ? `env:${connEnv}` : "unknown",
      ssl: c.pooled === true || /postgres|mysql/.test(c.engine),
      pooled: c.pooled ?? false,
      envVar: connEnv,
      collections: 0,
      filePath: "package.json",
    })
  })

  // --- Scan code for query smells ----------------------------------------
  const sqlEngine: DbEngine = detected.find((d) => d.engine === "postgres" || d.engine === "mysql")?.engine ?? "postgres"
  let queryId = 0

  for (const file of ctx.codeFiles()) {
    const content = await ctx.read(file.rel)
    if (!content) continue
    if (!/(query|sql|prisma|db\.|collection|find\(|aggregate|execute|\$queryRaw)/i.test(content)) continue
    const lines = content.split("\n")

    lines.forEach((line, idx) => {
      const lineNo = idx + 1

      // String-concatenated SQL → injection risk.
      if (/(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}/i.test(line) && /`[^`]*\$\{|["'][^"']*"\s*\+|\+\s*(req|request|params|query|body)/.test(line)) {
        findings.push(finding(`db-inj-${++queryId}`, sqlEngine, "injection", "critical", "Possible SQL injection", "Query appears to interpolate user input directly into SQL. Use parameterized queries.", file.rel, lineNo, "Use parameterized queries / prepared statements instead of string concatenation.", snippetAround(content, lineNo)))
      }

      // $queryRawUnsafe / raw execution.
      if (/queryRawUnsafe|executeRawUnsafe|\.raw\(/.test(line)) {
        findings.push(finding(`db-raw-${++queryId}`, sqlEngine, "unparameterized", "high", "Unsafe raw query", "Raw/unsafe query execution bypasses parameterization.", file.rel, lineNo, "Prefer the safe tagged-template or parameterized variant.", snippetAround(content, lineNo)))
      }

      // SELECT * without LIMIT → unbounded.
      if (/SELECT\s+\*/i.test(line) && !/\blimit\b/i.test(line)) {
        findings.push(finding(`db-unb-${++queryId}`, sqlEngine, "unbounded-query", "medium", "Unbounded SELECT *", "Selecting all columns/rows without a LIMIT can load excessive data.", file.rel, lineNo, "Select only needed columns and add a LIMIT / pagination.", snippetAround(content, lineNo)))
        queries.push({ id: `q-${queryId}`, engine: sqlEngine, operation: "SELECT", target: "(table)", filePath: file.rel, line: lineNo, estMs: 120, fullScan: true, note: "SELECT * without LIMIT" })
      }

      // findOne/find in loops → potential N+1 (heuristic: find inside map/for on same line region).
      if (/\.(find|findOne|findUnique|aggregate)\s*\(/.test(line) && /(\.map\(|for\s*\(|forEach)/.test(lines.slice(Math.max(0, idx - 3), idx).join("\n"))) {
        findings.push(finding(`db-nplus-${++queryId}`, detected.find((d) => d.engine === "mongodb") ? "mongodb" : sqlEngine, "n+1", "high", "Potential N+1 query", "A query inside a loop can trigger many round-trips.", file.rel, lineNo, "Batch with a single query, JOIN, or use an IN clause / dataloader.", snippetAround(content, lineNo)))
      }
    })
  }

  // --- Config-level findings ---------------------------------------------
  if (detected.some((d) => d.engine === "postgres") && !detected.some((d) => d.pooled)) {
    findings.push(finding("db-pool", "postgres", "no-pooling", "medium", "No connection pooling detected", "Direct Postgres connections without pooling can exhaust connections under load on serverless.", "package.json", undefined, "Use a pooled driver (Neon serverless, @vercel/postgres) or a pooler like PgBouncer."))
  }

  const collections = connections.reduce((s, c) => s + c.collections, 0)
  const slowQueries = queries.filter((q) => q.fullScan || q.estMs > 100).length

  return {
    connections,
    findings: findings.sort((a, b) => sevRank(b.severity) - sevRank(a.severity)),
    queries,
    counts: { connections: connections.length, collections, findings: findings.length, slowQueries },
  }
}

function finding(
  id: string,
  engine: DbEngine,
  kind: DbFinding["kind"],
  severity: Severity,
  title: string,
  detail: string,
  filePath: string,
  line: number | undefined,
  recommendation: string,
  snippet?: { startLine: number; code: string },
): DbFinding {
  return { id, engine, kind, severity, title, detail, filePath, line, recommendation, snippet }
}

function sevRank(s: Severity): number {
  const order: Record<string, number> = { critical: 6, high: 5, error: 5, medium: 4, warning: 3, low: 2, info: 1 }
  return order[s] ?? 0
}
