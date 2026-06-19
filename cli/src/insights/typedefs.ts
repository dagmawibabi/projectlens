import { type ScanContext } from "./scan.js"
import type { TypeDefinition, TypeMember, TypeKind } from "../types.js"

/**
 * Lightweight TypeScript declaration extractor. Parses exported (and top-level)
 * interfaces, type aliases, enums, and classes via balanced-brace scanning —
 * not a full TS AST, but accurate enough to populate the type explorer.
 */
export async function collectTypeDefinitions(ctx: ScanContext): Promise<TypeDefinition[]> {
  const defs: TypeDefinition[] = []

  // First pass: collect declarations.
  const files = ctx.codeFiles((rel) => /\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts"))
  for (const file of files) {
    const content = await ctx.read(file.rel)
    if (!content) continue
    extractFromFile(file.rel, content, defs)
  }

  // Second pass: count references across the codebase (cheap name search).
  if (defs.length > 0 && defs.length <= 400) {
    const names = defs.map((d) => d.name)
    const counts = new Map<string, number>(names.map((n) => [n, 0]))
    for (const file of files) {
      const content = await ctx.read(file.rel)
      if (!content) continue
      for (const name of names) {
        const re = new RegExp(`\\b${escapeRe(name)}\\b`, "g")
        const m = content.match(re)
        if (m) counts.set(name, (counts.get(name) ?? 0) + m.length)
      }
    }
    for (const d of defs) {
      // Subtract 1 for the declaration itself.
      d.references = Math.max(0, (counts.get(d.name) ?? 1) - 1)
    }
  }

  return defs.sort((a, b) => b.references - a.references).slice(0, 500)
}

const DECL_RE =
  /(?:^|\n)([ \t]*)(export\s+)?(?:declare\s+)?(?:(abstract)\s+)?(interface|type|enum|class)\s+([A-Za-z_$][\w$]*)\s*(<[^>{=]*>)?/g

function extractFromFile(filePath: string, content: string, out: TypeDefinition[]): void {
  const lines = content.split("\n")
  let m: RegExpExecArray | null
  DECL_RE.lastIndex = 0
  while ((m = DECL_RE.exec(content)) !== null) {
    const [, , exportKw, , kindRaw, name, generics] = m
    const kind = kindRaw as TypeKind
    const declStart = m.index + (m[0].startsWith("\n") ? 1 : 0)
    const line = content.slice(0, declStart).split("\n").length

    // Doc comment immediately above.
    const doc = extractDocAbove(lines, line - 1)

    let source = ""
    let members: TypeMember[] = []
    let extendsFrom: string[] | undefined

    if (kind === "type") {
      // type X = ... ;  (up to the terminating semicolon/newline at depth 0)
      const eq = content.indexOf("=", m.index)
      const body = readTypeAlias(content, eq + 1)
      source = `type ${name}${generics ?? ""} = ${body.trim()}`
      members = parseUnionOrObjectMembers(body)
      extendsFrom = parseUnionRefs(body)
    } else {
      const braceStart = content.indexOf("{", m.index)
      if (braceStart === -1) continue
      const heading = content.slice(m.index, braceStart)
      extendsFrom = parseHeritage(heading)
      const block = readBalanced(content, braceStart)
      source = `${exportKw ? "export " : ""}${kindRaw} ${name}${generics ?? ""}${formatHeritage(extendsFrom, kind)} ${block}`
      members = kind === "enum" ? parseEnumMembers(block) : parseInterfaceMembers(block)
    }

    out.push({
      id: `type-${out.length + 1}`,
      name,
      kind,
      filePath,
      line,
      exported: Boolean(exportKw),
      references: 1,
      generics: generics ? splitGenerics(generics) : undefined,
      extendsFrom: extendsFrom && extendsFrom.length ? extendsFrom : undefined,
      members,
      source: source.slice(0, 4000),
      doc,
    })
  }
}

function extractDocAbove(lines: string[], declLineIdx: number): string | undefined {
  let i = declLineIdx - 1
  if (i < 0) return undefined
  if (!lines[i]?.trim().endsWith("*/")) return undefined
  const collected: string[] = []
  while (i >= 0) {
    collected.unshift(lines[i])
    if (lines[i].trim().startsWith("/**") || lines[i].trim().startsWith("/*")) break
    i--
  }
  const text = collected
    .join("\n")
    .replace(/\/\*\*?|\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim()
  return text || undefined
}

function readBalanced(content: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return content.slice(openIdx, i + 1)
    }
  }
  return content.slice(openIdx, Math.min(content.length, openIdx + 4000))
}

function readTypeAlias(content: string, start: number): string {
  let depth = 0
  for (let i = start; i < content.length; i++) {
    const ch = content[i]
    if (ch === "{" || ch === "(" || ch === "<" || ch === "[") depth++
    else if (ch === "}" || ch === ")" || ch === ">" || ch === "]") depth--
    else if ((ch === ";" || ch === "\n") && depth <= 0) {
      const slice = content.slice(start, i)
      if (ch === "\n" && /[=|&,(<{[]\s*$/.test(slice)) continue
      return slice
    }
  }
  return content.slice(start, Math.min(content.length, start + 2000))
}

function parseInterfaceMembers(block: string): TypeMember[] {
  const inner = block.replace(/^\{/, "").replace(/\}$/, "")
  const members: TypeMember[] = []
  // Split on semicolons/newlines at depth 0.
  let depth = 0
  let buf = ""
  const flush = () => {
    const line = buf.trim()
    buf = ""
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) return
    const mm = line.match(/^(readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/)
    if (mm) {
      members.push({
        name: mm[2],
        type: mm[4].replace(/[;,]\s*$/, "").trim().slice(0, 200),
        optional: Boolean(mm[3]),
        readonly: Boolean(mm[1]),
      })
    }
  }
  for (const ch of inner) {
    if (ch === "{" || ch === "(" || ch === "<" || ch === "[") depth++
    else if (ch === "}" || ch === ")" || ch === ">" || ch === "]") depth--
    if ((ch === ";" || ch === "\n") && depth <= 0) flush()
    else buf += ch
  }
  flush()
  return members.slice(0, 60)
}

function parseEnumMembers(block: string): TypeMember[] {
  const inner = block.replace(/^\{/, "").replace(/\}$/, "")
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, value] = entry.split("=").map((x) => x.trim())
      return { name: name.replace(/['"]/g, ""), type: value ? value.slice(0, 80) : "auto" }
    })
    .slice(0, 60)
}

function parseUnionOrObjectMembers(body: string): TypeMember[] {
  const trimmed = body.trim()
  if (trimmed.startsWith("{")) return parseInterfaceMembers(readBalanced(trimmed, 0))
  // Union of string literals → list each as a member.
  if (trimmed.includes("|")) {
    return trimmed
      .split("|")
      .map((s) => s.trim().replace(/[;]/g, ""))
      .filter(Boolean)
      .slice(0, 40)
      .map((v) => ({ name: v, type: "union member" }))
  }
  return []
}

function parseUnionRefs(body: string): string[] | undefined {
  if (!body.includes("|")) return undefined
  const refs = body
    .split("|")
    .map((s) => s.trim().replace(/[;]/g, ""))
    .filter((s) => /^[A-Za-z_$][\w$.]*$/.test(s))
  return refs.length ? refs.slice(0, 20) : undefined
}

function parseHeritage(heading: string): string[] {
  const ext = heading.match(/extends\s+([^{]+?)(?:implements|$)/)?.[1] ?? ""
  const impl = heading.match(/implements\s+([^{]+)$/)?.[1] ?? ""
  return [...ext.split(","), ...impl.split(",")]
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 80))
}

function formatHeritage(refs: string[] | undefined, kind: TypeKind): string {
  if (!refs || !refs.length || kind === "enum") return ""
  return ` extends ${refs.join(", ")}`
}

function splitGenerics(generics: string): string[] {
  return generics
    .replace(/^<|>$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
