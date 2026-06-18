"use client"

import { useMemo, useState } from "react"
import { ChevronRight, ShieldAlert, ShieldCheck, Package, ExternalLink } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CodeBlock } from "./code-block"
import { InsightCard, ProportionBar, CountList } from "./insights"
import { severityStyle, bySeverityDesc } from "@/lib/severity"
import type { SecurityResult, SecurityFinding, DependencyVuln } from "@/lib/schema"
import { cn } from "@/lib/utils"

function DiffBlock({ fix }: { fix: string }) {
  const lines = fix.replace(/\n$/, "").split("\n")
  return (
    <pre className="overflow-x-auto rounded-sm border border-border bg-background/60 py-2 font-mono text-xs leading-relaxed">
      <code className="block">
        {lines.map((line, i) => {
          const isAdd = line.startsWith("+")
          const isDel = line.startsWith("-")
          return (
            <div
              key={i}
              className={cn(
                "flex whitespace-pre border-l-2 px-3",
                isAdd && "border-foreground bg-foreground/[0.07] text-foreground",
                isDel && "border-muted-foreground/40 text-muted-foreground line-through decoration-muted-foreground/40",
                !isAdd && !isDel && "border-transparent text-foreground/60",
              )}
            >
              {line || " "}
            </div>
          )
        })}
      </code>
    </pre>
  )
}

function FindingCard({ finding }: { finding: SecurityFinding }) {
  const [open, setOpen] = useState(false)
  const sev = severityStyle(finding.severity)

  return (
    <Card className={cn("gap-0 overflow-hidden border-l-2 py-0", sev.border)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-secondary/40"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("border-0 font-mono text-[10px] uppercase", sev.bg, sev.text)}>{sev.label}</Badge>
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              {finding.category}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {finding.filePath}:{finding.line}
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {Math.round(finding.confidence * 100)}% conf.
            </span>
          </div>
          <p className="mt-2 text-pretty text-sm font-medium text-foreground">{finding.title}</p>
        </div>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border bg-secondary/20 px-4 py-4">
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{finding.description}</p>

          {finding.snippet && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Vulnerable code</p>
              <CodeBlock startLine={finding.snippet.startLine} code={finding.snippet.code} highlightLine={finding.line} />
            </div>
          )}

          <div className="rounded-sm border border-border bg-card p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recommendation</p>
            <p className="mt-1 text-pretty text-sm leading-relaxed text-foreground">{finding.recommendation}</p>
          </div>

          {finding.suggestedFix && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Suggested fix</p>
              <DiffBlock fix={finding.suggestedFix} />
            </div>
          )}

          {finding.reference && (
            <a
              href={`https://cwe.mitre.org/data/definitions/${finding.reference.replace("CWE-", "")}.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 font-mono text-xs text-primary hover:underline"
            >
              {finding.reference}
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </Card>
  )
}

function DependencyRow({ dep }: { dep: DependencyVuln }) {
  const sev = severityStyle(dep.severity)
  return (
    <div className="flex flex-col gap-2 border-t border-border p-4 first:border-t-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-foreground">{dep.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{dep.currentVersion}</span>
            <Badge className={cn("border-0 font-mono text-[10px] uppercase", sev.bg, sev.text)}>{sev.label}</Badge>
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {dep.dependencyType}
            </span>
          </div>
          <p className="mt-1 text-sm text-foreground">{dep.title}</p>
          {dep.impact && <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">{dep.impact}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
            {dep.cves.map((cve) => (
              <span key={cve} className="rounded-sm bg-secondary px-1.5 py-0.5">
                {cve}
              </span>
            ))}
          </div>
        </div>
      </div>
      {dep.fixedIn && (
        <div className="shrink-0 rounded-sm border border-[color:var(--sev-ok)]/40 bg-[color:var(--sev-ok)]/10 px-2.5 py-1 font-mono text-xs text-[color:var(--sev-ok)]">
          {dep.currentVersion} → {dep.fixedIn}
        </div>
      )}
    </div>
  )
}

export function SecurityPanel({ security }: { security: SecurityResult }) {
  const findings = useMemo(() => [...security.findings].sort(bySeverityDesc), [security.findings])
  const deps = useMemo(() => [...security.dependencies].sort(bySeverityDesc), [security.dependencies])

  const sevSegments = (["critical", "high", "medium", "low", "info"] as const).map((s, i) => ({
    label: severityStyle(s).label,
    value: security.findings.filter((f) => f.severity === s).length,
    color: `var(--chart-${i + 1})`,
  }))

  const categoryRows = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of security.findings) map.set(f.category, (map.get(f.category) ?? 0) + 1)
    return [...map.entries()].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count)
  }, [security.findings])

  if (security.skipped) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">AI security audit skipped</p>
          <p className="max-w-sm text-pretty text-sm text-muted-foreground">
            No AI key was configured. Set AI_GATEWAY_API_KEY to enable the code review and dependency prioritization.
          </p>
        </div>
      </Card>
    )
  }

  const criticalHigh = security.findings.filter((f) => f.severity === "critical" || f.severity === "high").length

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Posture rail */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <InsightCard title="Posture">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {security.findings.length}
              </span>
              <span className="text-[11px] text-muted-foreground">code findings</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{criticalHigh}</span>
              <span className="text-[11px] text-muted-foreground">critical + high</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{deps.length}</span>
              <span className="text-[11px] text-muted-foreground">vuln deps</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {deps.filter((d) => d.fixedIn).length}
              </span>
              <span className="text-[11px] text-muted-foreground">patch available</span>
            </div>
          </div>
        </InsightCard>

        <InsightCard title="By severity">
          <ProportionBar segments={sevSegments} />
        </InsightCard>

        <InsightCard title="By category">
          <CountList rows={categoryRows} emptyLabel="No findings." />
        </InsightCard>
      </aside>

      {/* Main findings */}
      <div className="flex min-w-0 flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-[color:var(--sev-high)]" />
            <h3 className="text-sm font-semibold text-foreground">Code findings</h3>
            <Badge variant="secondary" className="font-mono text-xs">
              {findings.length}
            </Badge>
          </div>
          {findings.length === 0 ? (
            <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <ShieldCheck className="size-5 text-[color:var(--sev-ok)]" />
              No code-level security issues found by the AI review.
            </Card>
          ) : (
            findings.map((f) => <FindingCard key={f.id} finding={f} />)
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-[color:var(--sev-medium)]" />
            <h3 className="text-sm font-semibold text-foreground">Vulnerable dependencies</h3>
            <Badge variant="secondary" className="font-mono text-xs">
              {deps.length}
            </Badge>
          </div>
          {deps.length === 0 ? (
            <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <ShieldCheck className="size-5 text-[color:var(--sev-ok)]" />
              No known advisories in your dependency tree.
            </Card>
          ) : (
            <Card className="gap-0 overflow-hidden py-0">{deps.map((d) => <DependencyRow key={d.name} dep={d} />)}</Card>
          )}
        </section>
      </div>
    </div>
  )
}
