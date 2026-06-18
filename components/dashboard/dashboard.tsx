"use client"

import { useCallback, useEffect, useState } from "react"
import {
  LayoutDashboard,
  FileText,
  Braces,
  ShieldAlert,
  Package,
  Database,
  KeyRound,
  Globe,
  GitBranch,
  Settings2,
  BookOpen,
  Search,
  Accessibility,
  Gauge,
  FlaskConical,
} from "lucide-react"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RunHeader } from "./run-header"
import { OverviewPanel } from "./overview-panel"
import { LintPanel } from "./lint-panel"
import { TypesPanel } from "./types-panel"
import { SecurityPanel } from "./security-panel"
import { DependenciesPanel } from "./dependencies-panel"
import { DatabasePanel } from "./database-panel"
import { EnvPanel } from "./env-panel"
import { NetworkPanel } from "./network-panel"
import { GitPanel } from "./git-panel"
import { SetupPanel } from "./setup-panel"
import { DocsPanel } from "./docs-panel"
import { AccessibilityPanel } from "./accessibility-panel"
import { PerformancePanel } from "./performance-panel"
import { TestsPanel } from "./tests-panel"
import { InspectorProvider } from "./inspector"
import { CommandPalette, type TabDef } from "./command-palette"
import type { AnalysisReport, TrendPoint } from "@/lib/schema"
import type { ProjectInsights } from "@/lib/project-insights"
import { cn } from "@/lib/utils"

interface NavGroup {
  label?: string
  items: TabDef[]
}

const NAV_GROUPS: NavGroup[] = [
  { items: [{ value: "overview", label: "Overview", icon: LayoutDashboard }] },
  {
    label: "Code Quality",
    items: [
      { value: "lint", label: "Lint", icon: FileText },
      { value: "types", label: "Types", icon: Braces },
      { value: "tests", label: "Tests", icon: FlaskConical },
    ],
  },
  {
    label: "Security",
    items: [
      { value: "security", label: "Security", icon: ShieldAlert },
      { value: "deps", label: "Dependencies", icon: Package },
      { value: "env", label: "Environment", icon: KeyRound },
      { value: "network", label: "Network", icon: Globe },
    ],
  },
  {
    label: "Experience",
    items: [
      { value: "performance", label: "Performance", icon: Gauge },
      { value: "accessibility", label: "Accessibility", icon: Accessibility },
    ],
  },
  {
    label: "Project",
    items: [
      { value: "setup", label: "Setup", icon: Settings2 },
      { value: "database", label: "Database", icon: Database },
      { value: "git", label: "Git & CI/CD", icon: GitBranch },
      { value: "docs", label: "Docs", icon: BookOpen },
    ],
  },
]

/** Flat list of all tabs, in nav order, for the palette and shortcuts. */
const TABS: TabDef[] = NAV_GROUPS.flatMap((g) => g.items)

export function Dashboard({
  report,
  history,
  insights,
}: {
  report: AnalysisReport
  history: TrendPoint[]
  insights: ProjectInsights
}) {
  const { lint, types, security, deps } = report
  const [tab, setTab] = useState("overview")
  const [paletteOpen, setPaletteOpen] = useState(false)

  const counts: Record<string, number> = {
    lint: lint.errorCount + lint.warningCount,
    types: types.diagnostics.length,
    tests: insights.tests.findings.length,
    security: security.findings.length,
    deps: deps.findings.length,
    env: insights.env.counts.issues,
    network: insights.network.counts.issues,
    performance: insights.performance.findings.length,
    accessibility: insights.accessibility.violations.length,
    database: insights.database.findings.length,
    git: insights.git.issues.length + insights.git.workflows.reduce((s, w) => s + w.issues.length, 0),
    docs: insights.docs.standards
      .flatMap((s) => s.checks)
      .filter((c) => c.status === "fail" || c.status === "warn").length,
  }

  const selectTab = useCallback((value: string) => setTab(value), [])

  const activeTab = TABS.find((t) => t.value === tab) ?? TABS[0]

  // Global keyboard shortcuts: Cmd/Ctrl+K opens search; number keys switch tabs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === "/") {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      // 1–9 then 0 map to the first ten tabs in nav order.
      const num = Number.parseInt(e.key, 10)
      if (!Number.isNaN(num)) {
        const idx = num === 0 ? 9 : num - 1
        if (TABS[idx]) {
          e.preventDefault()
          setTab(TABS[idx].value)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <main className="min-h-svh bg-background">
      <RunHeader
        project={report.meta.project}
        aiEnabled={report.meta.aiEnabled}
        lastRunMs={report.meta.durationMs}
        lastRunLabel="just now"
        onOpenSearch={() => setPaletteOpen(true)}
      />

      <InspectorProvider projectRoot={report.meta.project.root}>
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex flex-col gap-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-6"
          >
            {/* Mobile / tablet navigation */}
            <div className="flex items-center gap-2 lg:hidden">
              <Select value={tab} onValueChange={(v) => v && setTab(v)}>
                <SelectTrigger className="flex-1">
                  <span className="flex items-center gap-2">
                    <activeTab.icon className="size-4 text-muted-foreground" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {NAV_GROUPS.map((group, i) => (
                    <SelectGroup key={group.label ?? `group-${i}`}>
                      {group.label && <SelectLabel>{group.label}</SelectLabel>}
                      {group.items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          <span className="flex items-center gap-2">
                            <item.icon className="size-4 text-muted-foreground" />
                            {item.label}
                            {counts[item.value] > 0 && (
                              <span className="font-mono text-[10px] text-muted-foreground">{counts[item.value]}</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Search"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
              >
                <Search className="size-4" />
              </button>
            </div>

            {/* Desktop sidebar navigation */}
            <aside className="hidden lg:sticky lg:top-4 lg:block lg:self-start">
              <nav
                aria-label="Analysis sections"
                className="flex flex-col gap-5 rounded-sm border border-border bg-card p-3"
              >
                {NAV_GROUPS.map((group, i) => (
                  <div key={group.label ?? `group-${i}`} className="flex flex-col gap-0.5">
                    {group.label && (
                      <p className="px-2 pb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {group.label}
                      </p>
                    )}
                    {group.items.map((item) => {
                      const active = tab === item.value
                      return (
                        <button
                          key={item.value}
                          type="button"
                          aria-current={active ? "page" : undefined}
                          onClick={() => setTab(item.value)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors",
                            active
                              ? "bg-secondary font-medium text-foreground"
                              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                          )}
                        >
                          <item.icon className="size-4 shrink-0" />
                          <span className="flex-1 truncate text-left">{item.label}</span>
                          {counts[item.value] > 0 && (
                            <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                              {counts[item.value]}
                            </Badge>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  className="mt-1 flex items-center gap-2 rounded-sm border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Search className="size-3.5" />
                  <span className="flex-1 text-left">Search</span>
                  <kbd className="rounded-[3px] border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
                </button>
              </nav>
            </aside>

            {/* Content */}
            <div className="min-w-0">
              <TabsContent value="overview">
                <OverviewPanel report={report} history={history} insights={insights} />
              </TabsContent>
              <TabsContent value="lint">
                <LintPanel lint={lint} />
              </TabsContent>
              <TabsContent value="types">
                <TypesPanel types={types} />
              </TabsContent>
              <TabsContent value="tests">
                <TestsPanel tests={insights.tests} />
              </TabsContent>
              <TabsContent value="security">
                <SecurityPanel security={security} />
              </TabsContent>
              <TabsContent value="deps">
                <DependenciesPanel deps={deps} />
              </TabsContent>
              <TabsContent value="env">
                <EnvPanel env={insights.env} />
              </TabsContent>
              <TabsContent value="network">
                <NetworkPanel network={insights.network} />
              </TabsContent>
              <TabsContent value="performance">
                <PerformancePanel performance={insights.performance} />
              </TabsContent>
              <TabsContent value="accessibility">
                <AccessibilityPanel accessibility={insights.accessibility} />
              </TabsContent>
              <TabsContent value="database">
                <DatabasePanel database={insights.database} />
              </TabsContent>
              <TabsContent value="git">
                <GitPanel git={insights.git} />
              </TabsContent>
              <TabsContent value="setup">
                <SetupPanel setup={insights.setup} />
              </TabsContent>
              <TabsContent value="docs">
                <DocsPanel docs={insights.docs} />
              </TabsContent>
            </div>
          </Tabs>

          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            tabs={TABS}
            onSelectTab={selectTab}
            report={report}
            insights={insights}
          />
        </div>
      </InspectorProvider>
    </main>
  )
}
