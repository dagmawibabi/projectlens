"use client"

import { useCallback, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { RunHeader } from "@/components/dashboard/run-header"
import { OverviewPanel } from "@/components/dashboard/overview-panel"
import { LintPanel } from "@/components/dashboard/lint-panel"
import { TypesPanel } from "@/components/dashboard/types-panel"
import { SecurityPanel } from "@/components/dashboard/security-panel"
import { mockReport, mockHistory } from "@/lib/mock-data"
import type { RunPhase, PhaseStatus } from "@/lib/schema"

const IDLE_PHASES: Record<RunPhase, PhaseStatus> = {
  detect: "idle",
  lint: "idle",
  types: "idle",
  deps: "idle",
  security: "idle",
}

const DONE_PHASES: Record<RunPhase, PhaseStatus> = {
  detect: "done",
  lint: "done",
  types: "done",
  deps: "done",
  security: "done",
}

const PHASE_ORDER: RunPhase[] = ["detect", "lint", "types", "deps", "security"]

export default function Page() {
  const report = mockReport
  const [running, setRunning] = useState(false)
  const [phases, setPhases] = useState<Record<RunPhase, PhaseStatus>>(DONE_PHASES)

  // Simulate a streaming run: phases light up sequentially. In the installed
  // CLI these transitions are driven by real WebSocket events.
  const handleRun = useCallback(() => {
    setRunning(true)
    setPhases(IDLE_PHASES)
    let i = 0

    const step = () => {
      const phase = PHASE_ORDER[i]
      setPhases((prev) => ({ ...prev, [phase]: "running" }))
      window.setTimeout(
        () => {
          setPhases((prev) => ({ ...prev, [phase]: "done" }))
          i += 1
          if (i < PHASE_ORDER.length) {
            step()
          } else {
            setRunning(false)
          }
        },
        420 + Math.random() * 480,
      )
    }
    step()
  }, [])

  const { lint, types, security } = report
  const securityCount = security.findings.length + security.dependencies.length

  return (
    <main className="min-h-svh bg-background">
      <RunHeader
        project={report.meta.project}
        aiEnabled={report.meta.aiEnabled}
        running={running}
        phases={phases}
        durationMs={report.meta.durationMs}
        onRun={handleRun}
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Tabs defaultValue="overview" className="flex flex-col gap-6">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="lint" className="gap-1.5">
              Lint
              <Badge variant="secondary" className="font-mono text-[10px]">
                {lint.errorCount + lint.warningCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="types" className="gap-1.5">
              Types
              <Badge variant="secondary" className="font-mono text-[10px]">
                {types.diagnostics.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5">
              Security
              <Badge variant="secondary" className="font-mono text-[10px]">
                {securityCount}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewPanel report={report} history={mockHistory} />
          </TabsContent>
          <TabsContent value="lint">
            <LintPanel lint={lint} />
          </TabsContent>
          <TabsContent value="types">
            <TypesPanel types={types} />
          </TabsContent>
          <TabsContent value="security">
            <SecurityPanel security={security} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
