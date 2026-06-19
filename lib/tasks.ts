"use client"

import { useCallback, useEffect, useState } from "react"
import type { Severity } from "./schema"
import type { Issue, IssueSource } from "./issues"

/** Workflow columns for the task board. */
export type TaskStatus = "todo" | "in-progress" | "done"
export type TaskPriority = "high" | "medium" | "low"

/**
 * A tracked remediation task. Tasks are created from findings across any tab
 * (lint, security, deps, a11y, …) and persisted locally so they survive
 * reloads. The installed CLI never sees these — they're a developer-side
 * worklist layered on top of the analysis.
 */
export interface Task {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  /** Which analysis surface this came from, when created from a finding. */
  source?: IssueSource
  severity?: Severity
  filePath?: string
  line?: number
  /** Free-form note the user can edit. */
  note?: string
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = "codelens.tasks.v1"
const EVENT = "codelens:tasks-changed"

const STATUS_ORDER: TaskStatus[] = ["todo", "in-progress", "done"]

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  "in-progress": "In progress",
  done: "Done",
}

/** Map a finding severity to a sensible default task priority. */
function severityToPriority(sev?: Severity): TaskPriority {
  switch (sev) {
    case "critical":
    case "high":
    case "error":
      return "high"
    case "medium":
    case "warning":
      return "medium"
    default:
      return "low"
  }
}

function read(): Task[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Task[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(tasks: Task[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  // Notify all hook instances in this tab (storage event only fires cross-tab).
  window.dispatchEvent(new CustomEvent(EVENT))
}

function uid(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Create a free-form task. Returns the created task. */
export function addTask(input: Partial<Task> & { title: string }): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: uid(),
    title: input.title,
    status: input.status ?? "todo",
    priority: input.priority ?? "medium",
    source: input.source,
    severity: input.severity,
    filePath: input.filePath,
    line: input.line,
    note: input.note,
    createdAt: now,
    updatedAt: now,
  }
  write([task, ...read()])
  return task
}

/**
 * Create a task from an inspector Issue. If a task already tracks the same
 * finding (matched on source + file + line + title) it is returned unchanged
 * so the board doesn't accumulate duplicates.
 */
export function addTaskFromIssue(issue: Issue): { task: Task; created: boolean } {
  const existing = read().find(
    (t) =>
      t.source === issue.source &&
      t.filePath === issue.filePath &&
      t.line === issue.line &&
      t.title === issue.title,
  )
  if (existing) return { task: existing, created: false }
  const task = addTask({
    title: issue.title,
    source: issue.source,
    severity: issue.severity,
    filePath: issue.filePath,
    line: issue.line,
    priority: severityToPriority(issue.severity),
    note: issue.recommendation,
  })
  return { task, created: true }
}

export function updateTask(id: string, patch: Partial<Task>) {
  const next = read().map((t) =>
    t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t,
  )
  write(next)
}

/** Advance a task to the next workflow column (wraps to the start). */
export function cycleStatus(id: string, direction: 1 | -1 = 1) {
  const t = read().find((x) => x.id === id)
  if (!t) return
  const idx = STATUS_ORDER.indexOf(t.status)
  const nextIdx = (idx + direction + STATUS_ORDER.length) % STATUS_ORDER.length
  updateTask(id, { status: STATUS_ORDER[nextIdx] })
}

export function removeTask(id: string) {
  write(read().filter((t) => t.id !== id))
}

export function clearDone() {
  write(read().filter((t) => t.status !== "done"))
}

/** React hook returning the live task list, synced across components + tabs. */
export function useTasks(): Task[] {
  const [tasks, setTasks] = useState<Task[]>([])

  const refresh = useCallback(() => setTasks(read()), [])

  useEffect(() => {
    refresh()
    const onChange = () => refresh()
    window.addEventListener(EVENT, onChange)
    window.addEventListener("storage", onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener("storage", onChange)
    }
  }, [refresh])

  return tasks
}
