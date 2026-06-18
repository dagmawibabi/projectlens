import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** A titled side-rail card used for contextual insights next to a panel. */
export function InsightCard({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-3 py-2">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </Card>
  )
}

/** Horizontal proportion bar made of monochrome segments. */
export function ProportionBar({
  segments,
}: {
  segments: { label: string; value: number; color: string }[]
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-sm border border-border">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
              <span className="text-muted-foreground">{s.label}</span>
            </span>
            <span className="font-mono tabular-nums text-foreground">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A ranked list of label → count rows, optionally clickable for filtering. */
export function CountList({
  rows,
  emptyLabel = "Nothing to show",
  activeKey,
  onSelect,
}: {
  rows: { key: string; label: string; count: number; hint?: string }[]
  emptyLabel?: string
  activeKey?: string | null
  onSelect?: (key: string) => void
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  }
  const max = Math.max(...rows.map((r) => r.count), 1)

  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => {
        const active = activeKey === r.key
        const Inner = (
          <>
            <span
              className="absolute inset-y-0 left-0 -z-0 bg-foreground/[0.06]"
              style={{ width: `${(r.count / max) * 100}%` }}
              aria-hidden
            />
            <span className="relative z-10 flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-xs text-foreground">{r.label}</span>
              {r.hint && <span className="truncate text-[10px] text-muted-foreground">{r.hint}</span>}
            </span>
            <span className="relative z-10 ml-2 font-mono text-xs tabular-nums text-muted-foreground">{r.count}</span>
          </>
        )
        const base =
          "relative flex items-center overflow-hidden rounded-sm px-2 py-1.5 text-left transition-colors"
        return (
          <li key={r.key}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(r.key)}
                className={cn(base, "w-full", active ? "ring-1 ring-ring" : "hover:bg-secondary/50")}
              >
                {Inner}
              </button>
            ) : (
              <div className={base}>{Inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
