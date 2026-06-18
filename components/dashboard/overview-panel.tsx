import { ArrowUpRight, Wrench, ShieldAlert, FileWarning, ArrowUpCircle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { HealthRing } from "./health-ring"
import { TrendChart } from "./trend-chart"
import { ReportExport } from "./report-export"
import { InsightCard, ProportionBar, CountList } from "./insights"
import { severityStyle } from "@/lib/severity"
import { computeUnifiedHealth, type HealthCategory } from "@/lib/health"
import type { AnalysisReport, TrendPoint, Severity } from "@/lib/schema"
import type { ProjectInsights } from "@/lib/project-insights"

interface OverviewPanelProps {
  report: AnalysisReport
  history: TrendPoint[]
  insights: ProjectInsights
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub: string
  accent: string
}) {
  return (
    <Card className="gap-2 p-4">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-3xl font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </Card>
  )
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--sev-ok)"
  if (score >= 60) return "var(--sev-medium)"
  if (score >= 40) return "var(--sev-high)"
  return "var(--sev-critical)"
}

function CategoryBar({ category }: { category: HealthCategory }) {
  const color = scoreColor(category.score)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-muted-foreground">{category.label}</span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
            {Math.round(category.weight * 100)}%
          </span>
        </span>
        <span className="shrink-0 font-mono tabular-nums" style={{ color }}>
          {category.score}
        </span>
      </div>
      <Progress value={category.score} className="h-1.5" />
    </div>
  )
}

interface Action {
  id: string
  icon: React.ElementType
  severity: Severity
  title: string
  detail: string
}

/** Derive a prioritized, actionable to-do list from the full report. */
function buildActions(report: AnalysisReport): Action[] {
  const { lint, types, security } = report
  const actions: Action[] = []

  for (const f of security.findings) {
    if (f.severity === "critical" || f.severity === "high") {
      actions.push({
        id: `sec-${f.id}`,
        icon: ShieldAlert,
        severity: f.severity,
        title: f.title,
        detail: `${f.filePath}:${f.line}`,
      })
    }
  }

  for (const d of security.dependencies) {
    if (d.fixedIn && (d.severity === "critical" || d.severity === "high")) {
      actions.push({
        id: `dep-${d.name}`,
        icon: ArrowUpCircle,
        severity: d.severity,
        title: `Upgrade ${d.name} to ${d.fixedIn}`,
        detail: d.cves.join(", "),
      })
    }
  }

  if (lint.fixableCount > 0) {
    actions.push({
      id: "lint-fix",
      icon: Wrench,
      severity: "warning",
      title: `Auto-fix ${lint.fixableCount} lint ${lint.fixableCount === 1 ? "issue" : "issues"}`,
      detail: "eslint . --fix",
    })
  }

  if (types.diagnostics.length > 0) {
    actions.push({
      id: "types",
      icon: FileWarning,
      severity: "high",
      title: `Resolve ${types.diagnostics.length} type ${types.diagnostics.length === 1 ? "error" : "errors"}`,
      detail: "tsc --noEmit",
    })
  }

  return actions.sort((a, b) => severityStyle(b.severity).rank - severityStyle(a.severity).rank).slice(0, 6)
}

/** Rank files by total issue count across lint, types, and security. */
function topFiles(report: AnalysisReport) {
  const counts = new Map<string, number>()
  const bump = (f: string) => counts.set(f, (counts.get(f) ?? 0) + 1)
  report.lint.messages.forEach((m) => bump(m.filePath))
  report.types.diagnostics.forEach((d) => bump(d.filePath))
  report.security.findings.forEach((f) => bump(f.filePath))
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
}

export function OverviewPanel({ report, history, insights }: OverviewPanelProps) {
  const { lint, types, security } = report
  const health = computeUnifiedHealth(report, insights)
  const critical = security.findings.filter((f) => f.severity === "critical").length
  const high = security.findings.filter((f) => f.severity === "high").length
  const prev = history.length >= 2 ? history[history.length - 2].score : null
  const delta = prev != null ? health.score - prev : null

  const actions = buildActions(report)
  const files = topFiles(report)

  const sevSegments = (["critical", "high", "medium", "low", "info"] as const).map((s, i) => ({
    label: severityStyle(s).label,
    value: security.findings.filter((f) => f.severity === s).length,
    color: `var(--chart-${i + 1})`,
  }))

  return (
    <div className="flex flex-col gap-4">
      {/* Section header with export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Project health</h2>
          <p className="text-xs text-muted-foreground">
            Weighted across {health.categories.length} analysis surfaces
          </p>
        </div>
        <ReportExport report={report} insights={insights} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Health score */}
        <Card className="flex flex-col items-center justify-center gap-4 p-6">
          <HealthRing score={health.score} grade={health.grade} />
          <div className="flex items-center gap-2 text-sm">
            {delta != null && (
              <span
                className="font-mono tabular-nums"
                style={{ color: delta >= 0 ? "var(--sev-ok)" : "var(--sev-critical)" }}
              >
                {delta >= 0 ? "+" : ""}
                {delta}
              </span>
            )}
            <span className="text-muted-foreground">vs previous run</span>
          </div>
        </Card>

        {/* Breakdown — every surface, weighted */}
        <Card className="flex flex-col gap-4 p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Score breakdown</h3>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              score · weight
            </span>
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {health.categories.map((c) => (
              <CategoryBar key={c.key} category={c} />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
      {/* Trend */}
      <Card className="flex flex-col gap-3 p-6 lg:col-span-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Health trend</h3>
          <span className="text-xs text-muted-foreground">{history.length} runs</span>
        </div>
        <TrendChart data={history} />
      </Card>

      {/* Stat row */}
      <StatCard
        label="Lint errors"
        value={lint.errorCount}
        sub={`${lint.warningCount} warnings · ${lint.fixableCount} auto-fixable`}
        accent={lint.errorCount > 0 ? "var(--sev-critical)" : "var(--sev-ok)"}
      />
      <StatCard
        label="Type errors"
        value={types.diagnostics.length}
        sub={types.unavailable ? "TypeScript not detected" : "from tsc --noEmit"}
        accent={types.diagnostics.length > 0 ? "var(--sev-high)" : "var(--sev-ok)"}
      />
      <StatCard
        label="Security findings"
        value={security.findings.length}
        sub={`${critical} critical · ${high} high · ${security.dependencies.length} vuln deps`}
        accent={critical > 0 ? "var(--sev-critical)" : high > 0 ? "var(--sev-high)" : "var(--sev-ok)"}
      />

      {/* Recommended actions */}
      <div className="lg:col-span-2">
        <InsightCard title="Recommended next actions">
          {actions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">All clear — nothing urgent to address.</p>
          ) : (
            <ol className="flex flex-col">
              {actions.map((a, i) => {
                const sev = severityStyle(a.severity)
                const Icon = a.icon
                return (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 border-t border-border py-2.5 first:border-t-0 first:pt-0.5"
                  >
                    <span className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-pretty text-sm text-foreground">{a.title}</span>
                      <span className="font-mono text-xs text-muted-foreground">{a.detail}</span>
                    </span>
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase ${sev.bg} ${sev.text}`}>
                      {sev.label}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </InsightCard>
      </div>

      {/* Findings by severity */}
      <InsightCard title="Findings by severity">
        <ProportionBar segments={sevSegments} />
      </InsightCard>

      {/* Top affected files */}
      <div className="lg:col-span-3">
        <InsightCard
          title="Most affected files"
          action={
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              issues <ArrowUpRight className="size-3" />
            </span>
          }
        >
          <div className="sm:columns-2 sm:gap-6">
            <CountList rows={files} emptyLabel="No issues across any files." />
          </div>
        </InsightCard>
      </div>
      </div>
    </div>
  )
}
