import { snippetAround, type ScanContext } from "./scan.js"
import type { A11yResult, A11yViolation, A11yImpact, WcagPrinciple } from "../types.js"

interface Rule {
  rule: string
  impact: A11yImpact
  principle: WcagPrinciple
  wcag: string[]
  description: string
  help: string
  helpUrl: string
  /** Returns true when the line violates the rule. */
  test: (line: string) => boolean
  recommendation: string
}

const RULES: Rule[] = [
  {
    rule: "image-alt",
    impact: "critical",
    principle: "Perceivable",
    wcag: ["1.1.1"],
    description: "Images must have alternate text",
    help: "Add an alt attribute to <img> elements",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/image-alt",
    test: (l) => /<img\b/.test(l) && !/\balt\s*=/.test(l),
    recommendation: 'Add a descriptive alt="" (empty for decorative images).',
  },
  {
    rule: "button-name",
    impact: "critical",
    principle: "Operable",
    wcag: ["4.1.2"],
    description: "Buttons must have discernible text",
    help: "Provide text content or aria-label on buttons",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/button-name",
    test: (l) => /<button\b[^>]*\/>/.test(l) || (/<button\b[^>]*>\s*<\/button>/.test(l) && !/aria-label/.test(l)),
    recommendation: "Add text content or an aria-label to the button.",
  },
  {
    rule: "label",
    impact: "serious",
    principle: "Perceivable",
    wcag: ["1.3.1", "4.1.2"],
    description: "Form elements must have labels",
    help: "Associate a <label> or aria-label with inputs",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/label",
    test: (l) => /<input\b/.test(l) && !/(aria-label|aria-labelledby|id\s*=|type\s*=\s*["'](hidden|submit|button)["'])/.test(l),
    recommendation: "Associate a <label htmlFor> or add aria-label to the input.",
  },
  {
    rule: "anchor-has-content",
    impact: "serious",
    principle: "Operable",
    wcag: ["2.4.4", "4.1.2"],
    description: "Links must have discernible text",
    help: "Provide text content or aria-label on links",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/link-name",
    test: (l) => /<a\b[^>]*>\s*<\/a>/.test(l) && !/aria-label/.test(l),
    recommendation: "Add link text or an aria-label.",
  },
  {
    rule: "html-has-lang",
    impact: "serious",
    principle: "Understandable",
    wcag: ["3.1.1"],
    description: "<html> element must have a lang attribute",
    help: "Add lang to the root <html>",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/html-has-lang",
    test: (l) => /<html\b/.test(l) && !/\blang\s*=/.test(l),
    recommendation: 'Add lang="en" (or appropriate locale) to <html>.',
  },
  {
    rule: "no-positive-tabindex",
    impact: "serious",
    principle: "Operable",
    wcag: ["2.4.3"],
    description: "Avoid positive tabindex values",
    help: "Positive tabindex disrupts natural focus order",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/tabindex",
    test: (l) => /tabindex\s*=\s*["']?[1-9]/i.test(l),
    recommendation: "Use tabindex={0} or restructure DOM order instead of positive values.",
  },
  {
    rule: "click-events-have-key-events",
    impact: "moderate",
    principle: "Operable",
    wcag: ["2.1.1"],
    description: "Clickable non-interactive elements need keyboard handlers",
    help: "Add onKeyDown/role/button when using onClick on div/span",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/aria-required-attr",
    test: (l) => /<(div|span)\b[^>]*onClick/.test(l) && !/(onKeyDown|onKeyUp|role\s*=)/.test(l),
    recommendation: "Use a <button>, or add role and keyboard handlers.",
  },
  {
    rule: "viewport-no-zoom",
    impact: "moderate",
    principle: "Perceivable",
    wcag: ["1.4.4"],
    description: "Users must be able to zoom",
    help: "Avoid user-scalable=no / maximum-scale=1",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.8/meta-viewport",
    test: (l) => /user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/.test(l),
    recommendation: "Remove user-scalable=no and allow zooming.",
  },
]

const IMPACT_WEIGHT: Record<A11yImpact, number> = { critical: 12, serious: 7, moderate: 3, minor: 1 }

export async function collectAccessibility(ctx: ScanContext): Promise<A11yResult> {
  const violations: A11yViolation[] = []
  let passes = 0
  let id = 0

  const jsxFiles = ctx.codeFiles((rel) => /\.(tsx|jsx|vue|svelte|html)$/.test(rel))

  for (const file of jsxFiles) {
    const content = await ctx.read(file.rel)
    if (!content || !/</.test(content)) continue
    const lines = content.split("\n")

    for (const rule of RULES) {
      let matchedInFile = false
      lines.forEach((line, idx) => {
        if (rule.test(line)) {
          matchedInFile = true
          violations.push({
            id: `a11y-${++id}`,
            rule: rule.rule,
            impact: rule.impact,
            principle: rule.principle,
            wcag: rule.wcag,
            description: rule.description,
            help: rule.help,
            helpUrl: rule.helpUrl,
            filePath: file.rel,
            line: idx + 1,
            selector: extractSelector(line),
            nodes: 1,
            recommendation: rule.recommendation,
            snippet: snippetAround(content, idx + 1),
          })
        }
      })
      if (!matchedInFile) passes++
    }
  }

  const counts = {
    critical: violations.filter((v) => v.impact === "critical").length,
    serious: violations.filter((v) => v.impact === "serious").length,
    moderate: violations.filter((v) => v.impact === "moderate").length,
    minor: violations.filter((v) => v.impact === "minor").length,
  }

  const penalty = violations.reduce((s, v) => s + IMPACT_WEIGHT[v.impact], 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))

  const byPrincipleMap = new Map<WcagPrinciple, number>()
  for (const v of violations) byPrincipleMap.set(v.principle, (byPrincipleMap.get(v.principle) ?? 0) + 1)
  const principles: WcagPrinciple[] = ["Perceivable", "Operable", "Understandable", "Robust"]

  return {
    score,
    violations: violations.sort((a, b) => IMPACT_WEIGHT[b.impact] - IMPACT_WEIGHT[a.impact]),
    passes,
    incomplete: 0,
    counts,
    byPrinciple: principles.map((principle) => ({ principle, count: byPrincipleMap.get(principle) ?? 0 })),
  }
}

function extractSelector(line: string): string {
  const tag = line.match(/<([a-zA-Z][\w-]*)/)?.[1] ?? "element"
  const cls = line.match(/className\s*=\s*["']([^"']+)["']/)?.[1]?.split(/\s+/)[0]
  return cls ? `${tag}.${cls}` : tag
}
