"use client"

import { FileText, Braces, ShieldAlert, ChevronRight } from "lucide-react"
import type { WorkspaceReport } from "@/lib/schema"
import { cn } from "@/lib/utils"


interface WorkspaceOverviewProps {
  workspace: WorkspaceReport
  onSelectPackage: (name: string) => void
}

function severityVar(score: number) {
  if (score >= 80) return "var(--sev-ok)"
  if (score >= 60) return "var(--sev-medium)"
  if (score >= 40) return "var(--sev-high)"
  return "var(--sev-critical)"
}

function MiniScore({ score, grade }: { score: number; grade: string }) {
  const color = severityVar(score)
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold tabular-nums"
      style={{ color, backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)` }}
    >
      {score}
    </div>
  )
}

function Stat({ icon: Icon, count, label }: { icon: typeof FileText; count: number; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
        count > 0
          ? "bg-secondary text-foreground"
          : "text-muted-foreground",
      )}
    >
      <Icon className="size-3 shrink-0" />
      {count}
    </span>
  )
}

export function WorkspaceOverview({ workspace, onSelectPackage }: WorkspaceOverviewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h3 className="font-mono text-sm font-medium text-foreground">Packages</h3>
          <p className="font-mono text-xs text-muted-foreground">
            {workspace.monorepo.packages.length} packages detected via {workspace.monorepo.tool}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">Aggregate</span>
          {(() => {
            const color = severityVar(workspace.aggregate.score)
            return (
              <span
                className="inline-flex h-7 items-center rounded-md px-2 font-mono text-xs font-semibold tabular-nums"
                style={{ color, backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)` }}
              >
                {workspace.aggregate.score}
                <span className="ml-1 text-[10px] font-medium opacity-70">{workspace.aggregate.grade}</span>
              </span>
            )
          })()}
        </div>
      </div>

      <div className="space-y-1">
        {workspace.aggregate.packageScores.map((ps) => {
          const pkgData = workspace.packages[ps.name]
          const report = pkgData?.report
          return (
            <button
              key={ps.name}
              type="button"
              onClick={() => onSelectPackage(ps.name)}
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
            >
              <MiniScore score={ps.score} grade={ps.grade} />

              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-medium text-foreground">
                  {ps.name}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Stat icon={FileText} count={report?.lint.errorCount ?? 0} label="lint" />
                  <Stat icon={Braces} count={report?.types.diagnostics.length ?? 0} label="types" />
                  <Stat icon={ShieldAlert} count={report?.security.findings.length ?? 0} label="security" />
                </div>
              </div>

              <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
