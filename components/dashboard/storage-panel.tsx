"use client"

import { useMemo, useState, useCallback } from "react"
import {
  HardDrive,
  Folder,
  Trash2,
  ArrowUpDown,
  Clock,
  Globe,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InsightCard, ProportionBar } from "./insights"
import type { StorageResult, StorageEntry, StorageDirKind } from "@/lib/project-insights"
import { cn } from "@/lib/utils"

const KIND_LABEL: Record<StorageDirKind, string> = {
  node_modules: "Dependencies",
  build: "Build output",
  cache: "Cache",
  coverage: "Coverage",
  other: "Other",
}

type SortKey = "size" | "path" | "modified"
type ScanMode = "project" | "machine"

const STORAGE_CHART_COLORS: Record<StorageDirKind, string> = {
  node_modules: "var(--chart-1)",
  build: "var(--chart-2)",
  cache: "var(--chart-3)",
  coverage: "var(--chart-4)",
  other: "var(--chart-5)",
}

/* ------------------------------------------------------------------ */
/* Entry row                                                           */
/* ------------------------------------------------------------------ */

function StorageRow({
  entry,
  maxBytes,
  onDelete,
  showPath,
}: {
  entry: StorageEntry
  maxBytes: number
  onDelete: (entry: StorageEntry) => void
  showPath?: boolean
}) {
  const barWidth = maxBytes > 0 ? (entry.sizeBytes / maxBytes) * 100 : 0
  const kindColor = STORAGE_CHART_COLORS[entry.kind]

  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
      <Folder className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm text-foreground">
            {showPath ? entry.absPath : entry.path}
          </span>
          <span
            className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground"
            style={{ borderColor: `color-mix(in oklch, ${kindColor} 40%, transparent)` }}
          >
            {entry.kind}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-secondary">
            <div
              className="h-full rounded-sm transition-all"
              style={{ width: `${barWidth}%`, background: kindColor }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">
            {entry.sizeLabel}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Clock className="size-3" />
          {entry.lastModifiedRelative}
        </div>
      </div>
      {entry.safeToDelete && (
        <Button
          variant="destructive"
          size="icon-xs"
          onClick={() => onDelete(entry)}
          aria-label={`Delete ${entry.path}`}
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Project group (machine mode)                                        */
/* ------------------------------------------------------------------ */

function ProjectGroup({
  projectPath,
  entries,
  maxBytes,
  onDelete,
}: {
  projectPath: string
  entries: StorageEntry[]
  maxBytes: number
  onDelete: (entry: StorageEntry) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const groupTotal = entries.reduce((sum, e) => sum + e.sizeBytes, 0)
  const groupTotalLabel = groupTotal >= 1_000_000_000
    ? `${(groupTotal / 1_000_000_000).toFixed(1)} GB`
    : groupTotal >= 1_000_000
      ? `${(groupTotal / 1_000_000).toFixed(0)} MB`
      : `${(groupTotal / 1_000).toFixed(0)} KB`

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-secondary/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-foreground">{projectPath}</span>
        <Badge variant="secondary" className="ml-auto font-mono text-[10px]">
          {entries.length} {entries.length === 1 ? "dir" : "dirs"}
        </Badge>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{groupTotalLabel}</span>
      </button>
      {expanded && (
        <div>
          {entries.map((entry) => (
            <StorageRow key={entry.id} entry={entry} maxBytes={maxBytes} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Delete confirmation dialog                                          */
/* ------------------------------------------------------------------ */

function DeleteDialog({
  entry,
  open,
  onOpenChange,
  onConfirm,
  scanMode,
}: {
  entry: StorageEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (entry: StorageEntry) => void
  scanMode: ScanMode
}) {
  if (!entry) return null

  const restoreHint =
    entry.kind === "node_modules"
      ? "Run your package manager's install command to restore."
      : "Rebuild your project to regenerate this directory."

  const location = scanMode === "machine" ? entry.absPath : entry.path

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete directory</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <span className="font-mono text-foreground">{location}</span>?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            This will free <span className="font-mono text-foreground">{entry.sizeLabel}</span> of disk space.
          </p>
          <p>{restoreHint}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(entry)
              onOpenChange(false)
            }}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function StoragePanel({ storage }: { storage: StorageResult }) {
  const [sortKey, setSortKey] = useState<SortKey>("size")
  const [deleteTarget, setDeleteTarget] = useState<StorageEntry | null>(null)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())

  // Machine scan state
  const [scanMode, setScanMode] = useState<ScanMode>("project")
  const [machineStorage, setMachineStorage] = useState<StorageResult | null>(null)
  const [isScanningMachine, setIsScanningMachine] = useState(false)
  const [machineScanError, setMachineScanError] = useState<string | null>(null)

  const activeStorage = scanMode === "machine" ? machineStorage : storage

  const handleScanMachine = useCallback(async () => {
    if (machineStorage) {
      setScanMode("machine")
      return
    }
    setIsScanningMachine(true)
    setMachineScanError(null)
    try {
      const res = await fetch("/api/storage/scan-machine", { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? `Scan failed (${res.status})`)
      }
      const data: StorageResult = await res.json()
      setMachineStorage(data)
      setScanMode("machine")
    } catch (err) {
      setMachineScanError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsScanningMachine(false)
    }
  }, [machineStorage])

  const handleDelete = useCallback(
    async (entry: StorageEntry) => {
      setDeletedIds((prev) => new Set(prev).add(entry.id))
      try {
        await fetch("/api/storage/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: scanMode === "machine" ? entry.absPath : entry.path,
            mode: scanMode,
          }),
        })
      } catch {
        // Optimistic UI — already removed from list
      }
    },
    [scanMode],
  )

  const visibleEntries = useMemo(
    () => (activeStorage?.entries ?? []).filter((e) => !deletedIds.has(e.id)),
    [activeStorage?.entries, deletedIds],
  )

  const sorted = useMemo(() => {
    const arr = [...visibleEntries]
    if (sortKey === "size") arr.sort((a, b) => b.sizeBytes - a.sizeBytes)
    else if (sortKey === "path") arr.sort((a, b) => a.path.localeCompare(b.path))
    else arr.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
    return arr
  }, [visibleEntries, sortKey])

  const maxBytes = useMemo(() => Math.max(...visibleEntries.map((e) => e.sizeBytes), 1), [visibleEntries])

  const categorySegments = useMemo(() => {
    const map = new Map<StorageDirKind, number>()
    for (const e of visibleEntries) map.set(e.kind, (map.get(e.kind) ?? 0) + e.sizeBytes)
    return [...map.entries()]
      .map(([kind, bytes]) => ({
        label: KIND_LABEL[kind],
        value: bytes,
        color: STORAGE_CHART_COLORS[kind],
      }))
      .sort((a, b) => b.value - a.value)
  }, [visibleEntries])

  const visibleCounts = useMemo(() => {
    const c = { total: 0, nodeModules: 0, build: 0, cache: 0, other: 0 }
    for (const e of visibleEntries) {
      c.total++
      if (e.kind === "node_modules") c.nodeModules++
      else if (e.kind === "build") c.build++
      else if (e.kind === "cache" || e.kind === "coverage") c.cache++
      else c.other++
    }
    return c
  }, [visibleEntries])

  // Group machine entries by parent project (two levels up from the target dir)
  const groupedEntries = useMemo(() => {
    if (scanMode !== "machine") return null
    const groups = new Map<string, StorageEntry[]>()
    for (const entry of sorted) {
      // e.g. "/home/user/projects/myapp/node_modules" → "/home/user/projects/myapp"
      const parts = entry.absPath.split("/")
      // Remove the target dir name and one parent level to get the project root
      const projectPath = parts.slice(0, Math.max(parts.length - 2, 1)).join("/")
      const group = groups.get(projectPath) ?? []
      group.push(entry)
      groups.set(projectPath, group)
    }
    return [...groups.entries()].sort((a, b) => {
      const aTotal = a[1].reduce((s, e) => s + e.sizeBytes, 0)
      const bTotal = b[1].reduce((s, e) => s + e.sizeBytes, 0)
      return bTotal - aTotal
    })
  }, [scanMode, sorted])

  const totalSizeLabel = activeStorage?.totalSizeLabel ?? "0 B"
  const totalSizeBytes = activeStorage?.totalSizeBytes ?? 0
  const largestEntry = activeStorage?.largestEntry

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      {/* Insights rail */}
      <aside className="flex flex-col gap-4 lg:order-last lg:sticky lg:top-20 lg:self-start">
        <InsightCard title="Inventory">
          <div className="grid grid-cols-2 gap-3 pb-3">
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {totalSizeLabel}
              </span>
              <span className="text-[11px] text-muted-foreground">total size</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {visibleCounts.total}
              </span>
              <span className="text-[11px] text-muted-foreground">directories</span>
            </div>
          </div>
          <div className="-mx-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-2 px-3 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">node_modules</span>
                <span className="tabular-nums text-foreground">{visibleCounts.nodeModules}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">build</span>
                <span className="tabular-nums text-foreground">{visibleCounts.build}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">cache</span>
                <span className="tabular-nums text-foreground">{visibleCounts.cache}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">other</span>
                <span className="tabular-nums text-foreground">{visibleCounts.other}</span>
              </div>
            </div>
          </div>
        </InsightCard>

        {categorySegments.length > 0 && (
          <InsightCard title="By category">
            <ProportionBar segments={categorySegments} />
          </InsightCard>
        )}

        {largestEntry && !deletedIds.has(largestEntry.id) && (
          <InsightCard title="Largest directory">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-sm text-foreground">{largestEntry.path}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {largestEntry.sizeLabel}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  of {totalSizeLabel}
                </span>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                Last modified {largestEntry.lastModifiedRelative}
              </p>
            </div>
          </InsightCard>
        )}

        {totalSizeBytes > 0 && (
          <InsightCard title="Space breakdown">
            <div className="flex flex-col gap-2">
              <div className="h-3 w-full overflow-hidden rounded-sm border border-border">
                {categorySegments.map((s) =>
                  s.value > 0 ? (
                    <div
                      key={s.label}
                      className="float-left h-full"
                      style={{ width: `${(s.value / (totalSizeBytes || 1)) * 100}%`, background: s.color }}
                      title={`${s.label}: ${s.value}`}
                    />
                  ) : null,
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {visibleEntries.length === (activeStorage?.entries.length ?? 0)
                  ? `Showing all ${activeStorage?.entries.length ?? 0} directories`
                  : `${visibleEntries.length} of ${activeStorage?.entries.length ?? 0} directories (some deleted)`}
              </p>
            </div>
          </InsightCard>
        )}
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-col gap-4">
        {/* Header with scan mode toggle */}
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Disk usage</h3>
          <Badge variant="secondary" className="font-mono text-xs">
            {totalSizeLabel}
          </Badge>

          <div className="ml-auto flex items-center gap-2">
            {/* Scan mode toggle */}
            <div className="flex items-center gap-1 rounded-sm border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setScanMode("project")}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
                  scanMode === "project"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HardDrive className="size-3" />
                Project
              </button>
              <button
                type="button"
                onClick={handleScanMachine}
                disabled={isScanningMachine}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
                  scanMode === "machine"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  isScanningMachine && "opacity-50 cursor-not-allowed",
                )}
              >
                {isScanningMachine ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Globe className="size-3" />
                )}
                Entire Machine
              </button>
            </div>

            {/* Sort controls */}
            <div className="flex items-center gap-1 rounded-sm border border-border bg-card p-1">
              {(
                [
                  { key: "size" as SortKey, label: "Size" },
                  { key: "path" as SortKey, label: "Path" },
                  { key: "modified" as SortKey, label: "Modified" },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSortKey(s.key)}
                  className={cn(
                    "rounded-sm px-2.5 py-1 text-xs transition-colors",
                    sortKey === s.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Machine scan error */}
        {machineScanError && (
          <Card className="flex items-center gap-3 border-[color:var(--sev-warn)] bg-[color:var(--sev-warn)]/10 p-4 text-sm text-[color:var(--sev-warn)]">
            <AlertTriangle className="size-4 shrink-0" />
            {machineScanError}
          </Card>
        )}

        {/* Machine scan loading */}
        {isScanningMachine && (
          <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Scanning home directory for storage targets...
          </Card>
        )}

        {/* Entry list */}
        {!isScanningMachine && sorted.length === 0 && !machineScanError && (
          <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldCheck className="size-5 text-[color:var(--sev-ok)]" />
            {scanMode === "machine"
              ? "No storage directories found on this machine."
              : "No storage directories found in this project."}
          </Card>
        )}

        {!isScanningMachine && sorted.length > 0 && scanMode === "machine" && groupedEntries && (
          <Card className="gap-0 overflow-hidden py-0">
            {groupedEntries.map(([projectPath, entries]) => (
              <ProjectGroup
                key={projectPath}
                projectPath={projectPath}
                entries={entries}
                maxBytes={maxBytes}
                onDelete={setDeleteTarget}
              />
            ))}
          </Card>
        )}

        {!isScanningMachine && sorted.length > 0 && scanMode === "project" && (
          <Card className="gap-0 overflow-hidden py-0">
            {sorted.map((entry) => (
              <StorageRow key={entry.id} entry={entry} maxBytes={maxBytes} onDelete={setDeleteTarget} />
            ))}
          </Card>
        )}

        {/* Safety note */}
        {sorted.length > 0 && (
          <div className="flex items-start gap-2 rounded-sm border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>
              {scanMode === "machine"
                ? "Scanning your home directory. Directories outside the current project are grouped by project path. "
                : ""}
              Directories marked as safe to delete can be removed to free disk space.{" "}
              <span className="font-mono text-foreground">node_modules</span> can be restored with your package manager's
              install command. Build and cache directories are regenerated automatically.
            </p>
          </div>
        )}
      </div>

      <DeleteDialog
        entry={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={handleDelete}
        scanMode={scanMode}
      />
    </div>
  )
}
