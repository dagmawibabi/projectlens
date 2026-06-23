import { promises as fs } from "node:fs"
import path from "node:path"
import type { StorageEntry, StorageResult, StorageDirKind } from "../insights-types.js"
import type { ScanContext } from "./scan.js"

/** Known directory targets and their categories. */
const TARGETS: { name: string; kind: StorageDirKind }[] = [
  { name: "node_modules", kind: "node_modules" },
  { name: ".next", kind: "build" },
  { name: "dist", kind: "build" },
  { name: "build", kind: "build" },
  { name: "out", kind: "build" },
  { name: ".cache", kind: "cache" },
  { name: ".turbo", kind: "cache" },
  { name: ".vercel", kind: "cache" },
  { name: "coverage", kind: "coverage" },
  { name: ".nyc_output", kind: "coverage" },
]

/** Directories to skip during machine-wide scans (never recurse into these). */
const MACHINE_IGNORE = new Set([
  ".git",
  ".svn",
  ".hg",
  ".fossil",
  ".Trash",
  ".Trashes",
  "System Volume Information",
  ".Spotlight-V100",
  ".fseventsd",
  ".nvm",
  ".rvm",
  ".rustup",
  ".pyenv",
  ".rbenv",
  ".asdf",
  ".deno",
  ".vscode",
  ".idea",
  ".vs",
  ".settings",
  "snap",
  ".flatpak-info",
])

const MAX_DEPTH = 4
const MACHINE_SCAN_DEPTH = 7
const FORMAT_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), FORMAT_UNITS.length - 1)
  const value = bytes / 1024 ** i
  return `${i === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${FORMAT_UNITS[i]}`
}

function formatRelativeTime(dateMs: number): string {
  const diff = Date.now() - dateMs
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

interface DirStats {
  sizeBytes: number
  lastModifiedMs: number
}

async function dirStats(dirPath: string, depth = 0): Promise<DirStats> {
  if (depth > MAX_DEPTH) return { sizeBytes: 0, lastModifiedMs: 0 }

  let sizeBytes = 0
  let lastModifiedMs = 0

  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return { sizeBytes: 0, lastModifiedMs: 0 }
  }

  const promises: Promise<void>[] = []

  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      promises.push(
        dirStats(abs, depth + 1).then((child) => {
          sizeBytes += child.sizeBytes
          if (child.lastModifiedMs > lastModifiedMs) lastModifiedMs = child.lastModifiedMs
        }),
      )
    } else if (entry.isFile()) {
      promises.push(
        fs.stat(abs).then((stat) => {
          sizeBytes += stat.size
          const mt = stat.mtimeMs
          if (mt > lastModifiedMs) lastModifiedMs = mt
        }),
      )
    }
  }

  await Promise.all(promises)
  return { sizeBytes, lastModifiedMs }
}

async function findTargetDirs(
  root: string,
  relativeBase: string,
  depth = 0,
): Promise<{ absPath: string; relPath: string }[]> {
  if (depth > MAX_DEPTH) return []

  const results: { absPath: string; relPath: string }[] = []

  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const subdirs: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith(".") && entry.name !== ".next") continue
    if (entry.name === "node_modules") {
      const abs = path.join(root, entry.name)
      const rel = relativeBase ? `${relativeBase}/node_modules` : "node_modules"
      results.push({ absPath: abs, relPath: rel })
      continue
    }
    const target = TARGETS.find((t) => t.name === entry.name)
    if (target) {
      const abs = path.join(root, entry.name)
      const rel = relativeBase ? `${relativeBase}/${entry.name}` : entry.name
      results.push({ absPath: abs, relPath: rel })
      continue
    }
    subdirs.push(entry.name)
  }

  if (depth < MAX_DEPTH) {
    const childResults = await Promise.all(
      subdirs.map((name) => {
        const abs = path.join(root, name)
        const rel = relativeBase ? `${relativeBase}/${name}` : name
        return findTargetDirs(abs, rel, depth + 1)
      }),
    )
    for (const r of childResults) results.push(...r)
  }

  return results
}

let idCounter = 0

function classifyKind(relPath: string): StorageDirKind {
  const base = path.basename(relPath)
  if (base === "node_modules") return "node_modules"
  const t = TARGETS.find((t) => t.name === base)
  return t?.kind ?? "other"
}

function buildStorageResult(entries: StorageEntry[]): StorageResult {
  entries.sort((a, b) => b.sizeBytes - a.sizeBytes)

  const totalSizeBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0)

  const counts = { total: entries.length, nodeModules: 0, build: 0, cache: 0, other: 0 }
  for (const e of entries) {
    if (e.kind === "node_modules") counts.nodeModules++
    else if (e.kind === "build") counts.build++
    else if (e.kind === "cache" || e.kind === "coverage") counts.cache++
    else counts.other++
  }

  return {
    entries,
    totalSizeBytes,
    totalSizeLabel: formatSize(totalSizeBytes),
    largestEntry: entries[0],
    counts,
  }
}

export async function collectStorage(scan: ScanContext): Promise<StorageResult> {
  const projectRoot = scan.root

  // Find all known target directories
  const targets = await findTargetDirs(projectRoot, "")

  // Compute stats for each
  const entries: StorageEntry[] = []

  await Promise.all(
    targets.map(async (t) => {
      const stats = await dirStats(t.absPath)
      if (stats.sizeBytes === 0) return

      const kind = classifyKind(t.relPath)
      const isKnownTarget = TARGETS.some((tgt) => t.absPath.endsWith(tgt.name))

      entries.push({
        id: `storage-${++idCounter}`,
        path: t.relPath,
        absPath: t.absPath,
        kind,
        sizeBytes: stats.sizeBytes,
        sizeLabel: formatSize(stats.sizeBytes),
        lastModified: new Date(stats.lastModifiedMs).toISOString(),
        lastModifiedRelative: stats.lastModifiedMs > 0 ? formatRelativeTime(stats.lastModifiedMs) : "—",
        safeToDelete: true,
        isKnownTarget,
      })
    }),
  )

  return buildStorageResult(entries)
}

/* ------------------------------------------------------------------ */
/* Machine-wide scan (npkill-style)                                    */
/* ------------------------------------------------------------------ */

async function findTargetDirsDeep(
  root: string,
  depth: number,
  maxDepth: number,
  results: string[],
): Promise<void> {
  if (depth > maxDepth) return

  let dir: import("node:fs").Dir
  try {
    dir = await fs.opendir(root)
  } catch {
    return // permission error or not a directory — skip silently
  }

  try {
    for await (const entry of dir) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (MACHINE_IGNORE.has(entry.name)) continue

      const full = path.join(root, entry.name)
      const base = entry.name

      // If the directory name matches a known target, record it and don't recurse into it
      if (TARGETS.some((t) => t.name === base)) {
        results.push(full)
        continue
      }

      await findTargetDirsDeep(full, depth + 1, maxDepth, results)
    }
  } catch {
    // permission errors mid-iteration — skip silently
  }
}

/**
 * Scan from a root directory (typically the user's home) for known storage
 * targets across the entire machine. Returns results relative to the scan root.
 */
export async function collectMachineStorage(homeDir: string): Promise<StorageResult> {
  const dirs: string[] = []
  await findTargetDirsDeep(homeDir, 0, MACHINE_SCAN_DEPTH, dirs)

  const entries: StorageEntry[] = []

  await Promise.all(
    dirs.map(async (absPath) => {
      const stats = await dirStats(absPath, 0)
      if (stats.sizeBytes === 0) return

      const kind = classifyKind(absPath)
      const isKnownTarget = TARGETS.some((t) => absPath.endsWith(t.name))

      // Path relative to home dir for display
      const relPath = path.relative(homeDir, absPath).split(path.sep).join("/")

      entries.push({
        id: `machine-${++idCounter}`,
        path: relPath,
        absPath,
        kind,
        sizeBytes: stats.sizeBytes,
        sizeLabel: formatSize(stats.sizeBytes),
        lastModified: new Date(stats.lastModifiedMs).toISOString(),
        lastModifiedRelative: stats.lastModifiedMs > 0 ? formatRelativeTime(stats.lastModifiedMs) : "—",
        safeToDelete: true,
        isKnownTarget,
      })
    }),
  )

  return buildStorageResult(entries)
}
