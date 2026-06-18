"use client"

import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileLink } from "./inspector"
import { InsightCard, CountList } from "./insights"
import type { TypeDefinition, TypeKind, TypeMember } from "@/lib/schema"
import { cn } from "@/lib/utils"
import { Braces, Brackets, Hash, Box, FunctionSquare, Search, Lock, Link2, ExternalLink } from "lucide-react"

const KIND_META: Record<TypeKind, { label: string; icon: typeof Braces; color: string }> = {
  interface: { label: "interface", icon: Braces, color: "var(--chart-1)" },
  type: { label: "type", icon: Brackets, color: "var(--chart-2)" },
  enum: { label: "enum", icon: Hash, color: "var(--chart-3)" },
  class: { label: "class", icon: Box, color: "var(--chart-4)" },
  function: { label: "function", icon: FunctionSquare, color: "var(--chart-5)" },
}

type KindFilter = "all" | TypeKind

function MemberRow({ m }: { m: TypeMember }) {
  return (
    <div className="flex items-baseline gap-2 border-t border-border py-2 font-mono text-xs first:border-t-0">
      <span className="inline-flex items-center gap-1 text-foreground">
        {m.readonly && <Lock className="size-3 text-muted-foreground" aria-label="readonly" />}
        {m.name}
        {m.optional && <span className="text-muted-foreground">?</span>}
      </span>
      <span className="text-muted-foreground">:</span>
      <span className="text-[color:var(--chart-2)]">{m.type}</span>
      {m.doc && <span className="ml-auto truncate text-[11px] text-muted-foreground">{m.doc}</span>}
    </div>
  )
}

function TypeDetail({ def, onSelectName }: { def: TypeDefinition; onSelectName: (name: string) => void }) {
  const meta = KIND_META[def.kind]
  return (
    <Card className="gap-0 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5">
          <meta.icon className="size-4" style={{ color: meta.color }} />
          <span className="font-mono text-sm font-semibold text-foreground">{def.name}</span>
        </span>
        {def.generics && def.generics.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground">{`<${def.generics.join(", ")}>`}</span>
        )}
        <Badge variant="secondary" className="font-mono text-[10px] uppercase">
          {meta.label}
        </Badge>
        {def.exported ? (
          <Badge className="border-0 bg-[color:var(--sev-ok)]/12 font-mono text-[10px] uppercase text-[color:var(--sev-ok)]">
            exported
          </Badge>
        ) : (
          <Badge variant="outline" className="font-mono text-[10px] uppercase text-muted-foreground">
            local
          </Badge>
        )}
      </div>

      {def.doc && <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{def.doc}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <FileLink path={def.filePath} line={def.line} />
        <span className="inline-flex items-center gap-1">
          <Link2 className="size-3" />
          {def.references} refs
        </span>
      </div>

      {def.extendsFrom && def.extendsFrom.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">extends</span>
          {def.extendsFrom.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onSelectName(name)}
              className="inline-flex items-center gap-1 rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-secondary/70"
            >
              {name}
              <ExternalLink className="size-2.5" />
            </button>
          ))}
        </div>
      )}

      {def.members.length > 0 && (
        <div className="mt-4">
          <span className="text-[11px] font-medium text-muted-foreground">
            {def.kind === "enum" ? "Members" : "Properties"} ({def.members.length})
          </span>
          <div className="mt-1">
            {def.members.map((m) => (
              <MemberRow key={m.name} m={m} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <span className="text-[11px] font-medium text-muted-foreground">Declaration</span>
        <pre className="mt-1 overflow-x-auto rounded-sm border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
          <code>{def.source}</code>
        </pre>
      </div>
    </Card>
  )
}

export function TypeExplorer({ definitions }: { definitions: TypeDefinition[] }) {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<KindFilter>("all")
  const [selectedId, setSelectedId] = useState<string>(definitions[0]?.id ?? "")

  const kindRows = useMemo(() => {
    const map = new Map<TypeKind, number>()
    for (const d of definitions) map.set(d.kind, (map.get(d.kind) ?? 0) + 1)
    return [...map.entries()]
      .map(([key, count]) => ({ key, label: KIND_META[key].label, count }))
      .sort((a, b) => b.count - a.count)
  }, [definitions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return definitions
      .filter((d) => (kind === "all" ? true : d.kind === kind))
      .filter((d) => (q ? d.name.toLowerCase().includes(q) || d.filePath.toLowerCase().includes(q) : true))
      .sort((a, b) => b.references - a.references)
  }, [definitions, kind, query])

  const selected = useMemo(
    () => definitions.find((d) => d.id === selectedId) ?? filtered[0] ?? definitions[0],
    [definitions, selectedId, filtered],
  )

  function selectByName(name: string) {
    const match = definitions.find((d) => d.name === name)
    if (match) setSelectedId(match.id)
  }

  const exportedCount = definitions.filter((d) => d.exported).length

  const filterTabs: { key: KindFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: definitions.length },
    ...kindRows.map((r) => ({ key: r.key as KindFilter, label: r.label, count: r.count })),
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* List rail */}
      <aside className="flex min-w-0 flex-col gap-4">
        <InsightCard title="Type inventory">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{definitions.length}</span>
              <span className="text-[11px] text-muted-foreground">declared</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{exportedCount}</span>
              <span className="text-[11px] text-muted-foreground">exported</span>
            </div>
          </div>
        </InsightCard>

        <InsightCard title="By kind">
          <CountList
            rows={kindRows}
            activeKey={kind === "all" ? null : kind}
            onSelect={(k) => setKind((p) => (p === k ? "all" : (k as KindFilter)))}
          />
        </InsightCard>

        <Card className="gap-0 p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter types…"
              className="w-full rounded-sm border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {filterTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setKind(t.key)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs transition-colors",
                  kind === t.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex max-h-[460px] flex-col overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No types match.</p>
            ) : (
              filtered.map((d) => {
                const meta = KIND_META[d.kind]
                const active = selected?.id === d.id
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-sm border-t border-border px-2 py-2 text-left transition-colors first:border-t-0",
                      active ? "bg-secondary" : "hover:bg-secondary/40",
                    )}
                  >
                    <meta.icon className="size-3.5 shrink-0" style={{ color: meta.color }} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{d.name}</span>
                    {!d.exported && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="local" />}
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{d.references}</span>
                  </button>
                )
              })
            )}
          </div>
        </Card>
      </aside>

      {/* Detail */}
      <div className="min-w-0">
        {selected ? (
          <TypeDetail def={selected} onSelectName={selectByName} />
        ) : (
          <Card className="p-6 text-sm text-muted-foreground">Select a type to explore its shape.</Card>
        )}
      </div>
    </div>
  )
}
