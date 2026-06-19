import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { ScanContext } from "./scan.js"
import type {
  GitResult,
  GitState,
  GitFileChange,
  GitIssue,
  CiWorkflow,
  CiStatus,
} from "../types.js"

const exec = promisify(execFile)

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, { cwd: root, timeout: 8000, maxBuffer: 4_000_000 })
    return stdout.trim()
  } catch {
    return null
  }
}

function parseStatus(porcelain: string): { changes: GitFileChange[]; staged: number } {
  const changes: GitFileChange[] = []
  let staged = 0
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue
    const x = line[0]
    const y = line[1]
    const file = line.slice(3)
    if (x !== " " && x !== "?") staged++
    let status: GitFileChange["status"] = "modified"
    if (x === "?" || y === "?") status = "untracked"
    else if (x === "A" || y === "A") status = "added"
    else if (x === "D" || y === "D") status = "deleted"
    else if (x === "R") status = "renamed"
    changes.push({ path: file, status })
  }
  return { changes, staged }
}

const CI_FILES: Array<{ glob: RegExp; provider: CiWorkflow["provider"] }> = [
  { glob: /^\.github\/workflows\/.*\.ya?ml$/, provider: "GitHub Actions" },
  { glob: /^\.gitlab-ci\.ya?ml$/, provider: "GitLab CI" },
  { glob: /^\.circleci\/config\.ya?ml$/, provider: "CircleCI" },
]

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "unknown"
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`
}

/**
 * Git + CI/CD intelligence. Shells out to the local `git` binary for repo
 * state and scans for CI workflow definitions. Degrades gracefully to an
 * "uninitialized repo" state when git is unavailable or the dir isn't a repo.
 */
export async function collectGit(ctx: ScanContext): Promise<GitResult> {
  const root = ctx.root
  const issues: GitIssue[] = []

  const isRepo = (await git(root, ["rev-parse", "--is-inside-work-tree"])) === "true"

  if (!isRepo) {
    return {
      state: emptyState(),
      issues: [
        {
          id: "git-noinit",
          kind: "gitignore",
          severity: "medium",
          title: "Not a git repository",
          detail: "This project is not under version control. Initialize a repo to track changes and enable CI.",
          recommendation: "Run `git init` and commit your work.",
        },
      ],
      workflows: await collectWorkflows(ctx),
    }
  }

  const [branch, statusOut, logOut, remoteOut, countOut, contribOut, defaultRef] = await Promise.all([
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(root, ["status", "--porcelain"]),
    git(root, ["log", "-1", "--format=%h%x1f%s%x1f%an%x1f%aI"]),
    git(root, ["remote", "get-url", "origin"]),
    git(root, ["rev-list", "--count", "HEAD"]),
    git(root, ["shortlog", "-sn", "--all", "--no-merges"]),
    git(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]),
  ])

  const { changes, staged } = parseStatus(statusOut ?? "")
  const [hash = "", message = "", author = "", date = ""] = (logOut ?? "").split("\u001f")
  const defaultBranch = defaultRef?.split("/").pop() ?? "main"
  const branchName = branch ?? "HEAD"

  let ahead = 0
  let behind = 0
  const counts = await git(root, ["rev-list", "--left-right", "--count", `${defaultBranch}...HEAD`])
  if (counts) {
    const [b, a] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10))
    behind = Number.isFinite(b) ? b : 0
    ahead = Number.isFinite(a) ? a : 0
  }

  const contributors = (contribOut ?? "").split("\n").filter((l) => l.trim()).length || 1
  const totalCommits = Number.parseInt(countOut ?? "0", 10) || 0

  const state: GitState = {
    branch: branchName,
    defaultBranch,
    ahead,
    behind,
    remote: remoteOut ?? "",
    lastCommit: {
      hash,
      message: message || "(no commits yet)",
      author: author || "unknown",
      relative: date ? relativeTime(date) : "unknown",
    },
    changes,
    staged,
    contributors,
    totalCommits,
  }

  // --- Issues -------------------------------------------------------------
  const gitignore = await ctx.read(".gitignore")
  if (gitignore == null) {
    issues.push({
      id: "git-gitignore",
      kind: "gitignore",
      severity: "high",
      title: "Missing .gitignore",
      detail: "No .gitignore found; build artifacts, secrets, and node_modules may be committed.",
      recommendation: "Add a .gitignore covering node_modules, .env*, and build output.",
    })
  } else {
    const missing = ["node_modules", ".env"].filter((p) => !gitignore.includes(p))
    if (missing.length) {
      issues.push({
        id: "git-gitignore-gaps",
        kind: "gitignore",
        severity: missing.includes(".env") ? "high" : "medium",
        title: `.gitignore missing ${missing.join(", ")}`,
        detail: `Patterns not ignored: ${missing.join(", ")}. Sensitive or bulky files may be tracked.`,
        filePath: ".gitignore",
        recommendation: `Add ${missing.join(" and ")} to .gitignore.`,
      })
    }
  }

  // Committed env files.
  for (const f of ctx.files) {
    if (/(^|\/)\.env(\.|$)/.test(f.rel) && !f.rel.endsWith(".example") && gitignore && !gitignore.includes(".env")) {
      issues.push({
        id: `git-env-${f.rel}`,
        kind: "secret-in-history",
        severity: "critical",
        title: `Potential secret file tracked: ${f.rel}`,
        detail: "An environment file may be committed to version control, exposing secrets in history.",
        filePath: f.rel,
        recommendation: "Remove it from tracking with `git rm --cached` and add it to .gitignore.",
      })
      break
    }
  }

  if (changes.length > 20) {
    issues.push({
      id: "git-uncommitted",
      kind: "uncommitted",
      severity: "low",
      title: `${changes.length} uncommitted changes`,
      detail: "A large number of pending changes makes review and rollback harder.",
      recommendation: "Commit work in focused, logical chunks.",
    })
  }

  // Large tracked files.
  const large = ctx.files.filter((f) => f.sizeBytes > 5_000_000).slice(0, 3)
  for (const f of large) {
    issues.push({
      id: `git-large-${f.rel}`,
      kind: "large-file",
      severity: "medium",
      title: `Large file: ${f.rel}`,
      detail: `${(f.sizeBytes / 1_000_000).toFixed(1)} MB file in the repo bloats clones. Consider Git LFS.`,
      filePath: f.rel,
      recommendation: "Track large binaries with Git LFS or move them to object storage.",
    })
  }

  return { state, issues, workflows: await collectWorkflows(ctx) }
}

async function collectWorkflows(ctx: ScanContext): Promise<CiWorkflow[]> {
  const workflows: CiWorkflow[] = []
  const ciFiles = ctx.files.filter((f) => CI_FILES.some((c) => c.glob.test(f.rel)))

  for (const f of ciFiles) {
    const provider = CI_FILES.find((c) => c.glob.test(f.rel))!.provider
    const body = (await ctx.read(f.rel)) ?? ""
    const triggers = extractTriggers(body)
    const jobNames = extractJobs(body)
    const status: CiStatus = "no-runs" // static analysis can't know live run status

    workflows.push({
      id: `wf-${workflows.length + 1}`,
      name: extractName(body) ?? f.rel.split("/").pop() ?? "workflow",
      file: f.rel,
      provider,
      triggers,
      status,
      jobs: jobNames.map((name) => ({ name, status })),
      issues: [],
    })
  }

  return workflows
}

function extractName(yaml: string): string | null {
  return yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/['"]/g, "") ?? null
}

function extractTriggers(yaml: string): string[] {
  const onBlock = yaml.match(/^on:\s*(.*)$/m)?.[1]?.trim()
  if (onBlock && onBlock !== "" && !onBlock.startsWith("#")) {
    if (onBlock.startsWith("[")) return onBlock.replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean)
    if (!onBlock.includes(":")) return [onBlock]
  }
  const triggers = new Set<string>()
  for (const t of ["push", "pull_request", "workflow_dispatch", "schedule", "release", "merge_group"]) {
    if (new RegExp(`^\\s+${t}:`, "m").test(yaml) || new RegExp(`\\b${t}\\b`).test(onBlock ?? "")) triggers.add(t)
  }
  return [...triggers]
}

function extractJobs(yaml: string): string[] {
  const jobsIdx = yaml.indexOf("\njobs:")
  if (jobsIdx === -1) return []
  const after = yaml.slice(jobsIdx)
  const names: string[] = []
  const re = /^\s{2}([A-Za-z0-9_-]+):\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(after)) !== null) names.push(m[1])
  return names.slice(0, 12)
}

function emptyState(): GitState {
  return {
    branch: "—",
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    remote: "",
    lastCommit: { hash: "", message: "(not a git repository)", author: "—", relative: "—" },
    changes: [],
    staged: 0,
    contributors: 0,
    totalCommits: 0,
  }
}
