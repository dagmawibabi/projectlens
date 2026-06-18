"use client"

import { useState } from "react"
import { HelpCircle, Terminal, Download, KeyRound, Play, ListChecks } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-sm border border-border bg-muted/60 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  )
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h3 className="font-mono text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="flex flex-col gap-2 border-l border-border pl-4">{children}</div>
    </section>
  )
}

const FLAGS: { flag: string; desc: string }[] = [
  { flag: "--ci", desc: "Run once, print a summary, and exit non-zero if thresholds are breached. No dashboard." },
  { flag: "--json", desc: "Write the full report as JSON to stdout for piping into other tools." },
  { flag: "--no-ai", desc: "Skip the AI security review (lint + types + dependency audit only)." },
  { flag: "--port <n>", desc: "Serve the dashboard on a specific port (default 4321)." },
  { flag: "--watch", desc: "Re-run affected checks automatically when files change." },
]

export function HelpDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="How to use CodeLens"
        className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-card px-3 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <HelpCircle className="size-4" />
        <span className="hidden sm:inline">Guide</span>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="font-mono">Using the CodeLens CLI</DialogTitle>
          <DialogDescription>
            CodeLens runs your real ESLint, TypeScript, and dependency-audit toolchain locally, then streams the
            results into this dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-5">
          <Section icon={Download} title="1 · Install">
            <p className="text-sm text-muted-foreground">Try it instantly with no install:</p>
            <Cmd>npx codelens</Cmd>
            <p className="text-sm text-muted-foreground">Or add it as a dev dependency to pin a version per project:</p>
            <Cmd>{`pnpm add -D codelens
# then add to package.json scripts: "lens": "codelens"`}</Cmd>
          </Section>

          <Section icon={KeyRound} title="2 · Configure the AI key">
            <p className="text-sm text-muted-foreground">
              Lint and type checks need no key. The AI security audit reads an API key from your environment or a local{" "}
              <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">.codelens.json</code>:
            </p>
            <Cmd>export AI_GATEWAY_API_KEY=your_key_here</Cmd>
          </Section>

          <Section icon={Play} title="3 · Run it in your project">
            <p className="text-sm text-muted-foreground">
              From the root of any JS/TS project (Next.js, SvelteKit, Vue, …). CodeLens auto-detects the framework and
              package manager, runs every check, and opens the dashboard at{" "}
              <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">localhost:4321</code>:
            </p>
            <Cmd>cd my-app &amp;&amp; codelens</Cmd>
          </Section>

          <Section icon={ListChecks} title="Flags">
            <ul className="flex flex-col gap-2">
              {FLAGS.map((f) => (
                <li key={f.flag} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <code className="shrink-0 font-mono text-xs text-foreground sm:w-28">{f.flag}</code>
                  <span className="text-sm text-muted-foreground">{f.desc}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section icon={Terminal} title="In CI">
            <p className="text-sm text-muted-foreground">
              The same engine drops into GitHub Actions. Fail the build when quality regresses:
            </p>
            <Cmd>{`- run: npx codelens --ci --no-ai
# exits non-zero past your configured thresholds`}</Cmd>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
