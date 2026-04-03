#!/usr/bin/env node

/**
 * ALPHACORE Agent CLI
 *
 * Primary tool for agents (Copilot, Codex, Claude) to read and mutate
 * ALPHACORE data without touching the browser UI.
 *
 * Requires running dev server: npm run dev (port 3004)
 *
 * Usage: npm run alpha -- <command> [args]
 */

const BASE = process.env.ALPHACORE_API ?? "http://localhost:3004";
const STORAGE = `${BASE}/api/storage`;
const SNAPSHOT = `${BASE}/api/agent-snapshot`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
        i += 1;
      } else {
        flags[key] = next;
        i += 2;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  return { positional, flags };
}

async function api(method, url, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    console.error(`❌ Cannot reach ALPHACORE dev server at ${BASE}`);
    console.error("   Make sure it's running: npm run dev");
    process.exit(1);
  }

  const data = await res.json();
  if (!res.ok) {
    console.error(`❌ API error ${res.status}:`, data.message ?? data.error ?? "Unknown");
    process.exit(1);
  }
  return data;
}

async function getKey(key) {
  const snapshot = await api("GET", STORAGE);
  return snapshot.items?.[key] ?? null;
}

async function putKey(key, value) {
  return api("PUT", STORAGE, { key, value });
}

// ── Task commands ────────────────────────────────────────────────────────────

async function taskAdd(args) {
  const { positional, flags } = parseArgs(args);
  const title = positional[0];
  if (!title) {
    console.error('Usage: task add "Title" [--priority p1|p2|p3] [--due YYYY-MM-DD] [--project name]');
    process.exit(1);
  }

  const tasks = (await getKey("alphacore_tasks")) ?? [];
  const task = {
    id: uid(),
    title,
    project: flags.project ?? undefined,
    priority: flags.priority ?? "p2",
    status: "inbox",
    dueDate: flags.due ?? undefined,
    createdAt: new Date().toISOString(),
  };
  tasks.unshift(task);
  await putKey("alphacore_tasks", tasks);
  console.info(`✅ Task added: [${task.priority.toUpperCase()}] ${task.title} (${task.id})`);
}

async function taskList(args) {
  const { flags } = parseArgs(args);
  const tasks = (await getKey("alphacore_tasks")) ?? [];
  const status = flags.status;
  const limit = flags.limit ? parseInt(flags.limit, 10) : 20;

  const filtered = status ? tasks.filter((t) => t.status === status) : tasks;
  const shown = filtered.slice(0, limit);

  if (shown.length === 0) {
    console.info("📭 No tasks found.");
    return;
  }

  console.info(`📋 Tasks (${shown.length}/${filtered.length}):\n`);
  for (const t of shown) {
    const due = t.dueDate ? ` due:${t.dueDate}` : "";
    const proj = t.project ? ` [${t.project}]` : "";
    console.info(`  ${t.status === "done" ? "✅" : "⬚"} ${t.priority.toUpperCase()} ${t.title}${proj}${due}  (${t.id})`);
  }
}

async function taskDone(args) {
  const { positional } = parseArgs(args);
  const id = positional[0];
  if (!id) {
    console.error("Usage: task done <id>");
    process.exit(1);
  }

  const tasks = (await getKey("alphacore_tasks")) ?? [];
  const task = tasks.find((t) => t.id === id || t.id.startsWith(id));
  if (!task) {
    console.error(`❌ Task not found: ${id}`);
    process.exit(1);
  }

  task.status = "done";
  task.completedAt = new Date().toISOString();
  await putKey("alphacore_tasks", tasks);
  console.info(`✅ Done: ${task.title}`);
}

// ── Journal commands ─────────────────────────────────────────────────────────

async function journalAdd(args) {
  const { positional, flags } = parseArgs(args);
  const text = positional[0];
  if (!text) {
    console.error('Usage: journal add "text" [--tags tag1,tag2] [--author user|assistant]');
    process.exit(1);
  }

  const entries = (await getKey("alphacore_journal")) ?? [];
  const entry = {
    id: uid(),
    author: flags.author ?? "assistant",
    text,
    tags: flags.tags ? flags.tags.split(",").map((t) => t.trim().toLowerCase()) : [],
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  await putKey("alphacore_journal", entries);
  console.info(`✅ Journal entry added (${entry.id}): ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
}

async function journalList(args) {
  const { flags } = parseArgs(args);
  const limit = flags.limit ? parseInt(flags.limit, 10) : 5;
  const entries = (await getKey("alphacore_journal")) ?? [];
  const shown = entries.slice(-limit);

  if (shown.length === 0) {
    console.info("📭 No journal entries.");
    return;
  }

  console.info(`📓 Journal (last ${shown.length}):\n`);
  for (const e of shown) {
    const tags = e.tags.length ? ` #${e.tags.join(" #")}` : "";
    const who = e.author === "assistant" ? "🤖" : "👤";
    console.info(`  ${who} ${e.text.slice(0, 80)}${e.text.length > 80 ? "…" : ""}${tags}`);
    console.info(`     ${e.createdAt}  (${e.id})\n`);
  }
}

// ── Note commands ────────────────────────────────────────────────────────────

async function noteAdd(args) {
  const { positional, flags } = parseArgs(args);
  const title = positional[0];
  if (!title) {
    console.error('Usage: note add "Title" [--body "..."] [--tags tag1,tag2]');
    process.exit(1);
  }

  const notes = (await getKey("alphacore_notes")) ?? [];
  const now = new Date().toISOString();
  const note = {
    id: uid(),
    title,
    body: flags.body ?? "",
    tags: flags.tags ? flags.tags.split(",").map((t) => t.trim().toLowerCase()) : [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  notes.unshift(note);
  await putKey("alphacore_notes", notes);
  console.info(`✅ Note added: ${title} (${note.id})`);
}

// ── Project commands ─────────────────────────────────────────────────────────

async function projectList() {
  const projects = (await getKey("alphacore_projects")) ?? [];
  if (projects.length === 0) {
    console.info("📭 No projects.");
    return;
  }

  console.info(`📁 Projects (${projects.length}):\n`);
  const statusIcon = { green: "🟢", yellow: "🟡", red: "🔴" };
  for (const p of projects) {
    const done = p.deliverables?.filter((d) => d.done).length ?? 0;
    const total = p.deliverables?.length ?? 0;
    console.info(`  ${statusIcon[p.status] ?? "⚪"} ${p.name} — ${done}/${total} deliverables`);
    if (p.nextStep) console.info(`     → ${p.nextStep}`);
    console.info(`     (${p.id})\n`);
  }
}

async function projectStatus(args) {
  const { positional } = parseArgs(args);
  const [idOrName, status] = positional;
  if (!idOrName || !status || !["green", "yellow", "red"].includes(status)) {
    console.error("Usage: project status <id|name> <green|yellow|red>");
    process.exit(1);
  }

  const projects = (await getKey("alphacore_projects")) ?? [];
  const lc = idOrName.toLowerCase();
  const project = projects.find(
    (p) => p.id === idOrName || p.id.startsWith(idOrName) || p.name.toLowerCase().includes(lc),
  );
  if (!project) {
    console.error(`❌ Project not found: ${idOrName}`);
    process.exit(1);
  }

  project.status = status;
  project.updatedAt = new Date().toISOString();
  await putKey("alphacore_projects", projects);
  console.info(`✅ Project "${project.name}" → ${status}`);
}

async function projectNextStep(args) {
  const { positional } = parseArgs(args);
  const [idOrName, ...rest] = positional;
  const step = rest.join(" ");
  if (!idOrName || !step) {
    console.error('Usage: project next-step <id|name> "step text"');
    process.exit(1);
  }

  const projects = (await getKey("alphacore_projects")) ?? [];
  const lc = idOrName.toLowerCase();
  const project = projects.find(
    (p) => p.id === idOrName || p.id.startsWith(idOrName) || p.name.toLowerCase().includes(lc),
  );
  if (!project) {
    console.error(`❌ Project not found: ${idOrName}`);
    process.exit(1);
  }

  project.nextStep = step;
  project.updatedAt = new Date().toISOString();
  await putKey("alphacore_projects", projects);
  console.info(`✅ Project "${project.name}" next step → ${step}`);
}

// ── Habit commands ───────────────────────────────────────────────────────────

async function habitCheck(args) {
  const { positional } = parseArgs(args);
  const habitId = positional[0];
  if (!habitId) {
    console.error("Usage: habit check <habitId>");
    process.exit(1);
  }

  const habits = (await getKey("alphacore_habits")) ?? {};
  const key = `${habitId}:${todayStr()}`;
  habits[key] = true;
  await putKey("alphacore_habits", habits);
  console.info(`✅ Habit checked: ${habitId} for ${todayStr()}`);
}

async function habitStatus() {
  const habits = (await getKey("alphacore_habits")) ?? {};
  const today = todayStr();
  const KNOWN = ["sleep", "run", "stretch", "projects_upd", "review", "drums"];

  console.info(`✅ Habit status for ${today}:\n`);
  for (const id of KNOWN) {
    const checked = habits[`${id}:${today}`] === true;
    console.info(`  ${checked ? "☑" : "☐"} ${id}`);
  }
}

// ── Medical commands ─────────────────────────────────────────────────────────

async function medicalAdd(args) {
  const { positional, flags } = parseArgs(args);
  const name = positional[0];
  if (!name || !flags.category || !flags.date || !flags.params) {
    console.error(
      'Usage: medical add "Name" --category blood|ultrasound|other --date YYYY-MM-DD --params "Name:Value:Unit:Min:Max,..."',
    );
    process.exit(1);
  }

  const params = flags.params.split(",").map((p) => {
    const [pName, value, unit, refMin, refMax] = p.split(":");
    return {
      name: pName,
      value: parseFloat(value),
      unit: unit ?? "",
      ...(refMin ? { refMin: parseFloat(refMin) } : {}),
      ...(refMax ? { refMax: parseFloat(refMax) } : {}),
    };
  });

  const entries = (await getKey("alphacore_medical")) ?? [];
  const entry = {
    id: uid(),
    date: flags.date,
    category: flags.category,
    name,
    params,
    notes: flags.notes ?? "",
    createdAt: new Date().toISOString(),
  };
  entries.unshift(entry);
  await putKey("alphacore_medical", entries);
  console.info(`✅ Medical entry added: ${name} (${entry.id}) with ${params.length} params`);
}

// ── Schedule commands ────────────────────────────────────────────────────────

const VALID_TONES = ["kinderly", "heys", "work", "health", "personal", "cleanup", "family", "review"];
const VALID_PRIORITIES = ["p1", "p2", "p3"];
const VALID_CLARIFICATION_REASONS = [
  "definition-of-done",
  "timing",
  "slotting",
  "priority",
  "execution-mode",
];
const VALID_CLARIFICATION_CONTEXT_MODES = ["normal", "energy-conflict", "overloaded"];

async function scheduleAdd(args) {
  const { positional, flags } = parseArgs(args);
  const title = positional[0];
  if (!title || !flags.date || !flags.start || !flags.end) {
    console.error(
      'Usage: schedule add "Title" --date YYYY-MM-DD --start HH:MM --end HH:MM [--tone work] [--tags tag1,tag2] [--priority p1|p2|p3] [--project name] [--event-only]',
    );
    process.exit(1);
  }

  const tone = flags.tone ?? "work";
  if (!VALID_TONES.includes(tone)) {
    console.error(`❌ Invalid tone: ${tone}. Valid: ${VALID_TONES.join(", ")}`);
    process.exit(1);
  }

  const priority = flags.priority ?? "p2";
  if (!VALID_PRIORITIES.includes(priority)) {
    console.error(`❌ Invalid priority: ${priority}. Valid: ${VALID_PRIORITIES.join(", ")}`);
    process.exit(1);
  }

  const events = (await getKey("alphacore_schedule_custom")) ?? [];
  const tasks = (await getKey("alphacore_tasks")) ?? [];
  const isEventOnly = Boolean(flags["event-only"]);
  const taskId = isEventOnly ? null : `custom-${uid()}`;
  const event = {
    id: `custom-${uid()}`,
    date: flags.date,
    start: flags.start,
    end: flags.end,
    title,
    tone,
    tags: flags.tags ? flags.tags.split(",").map((t) => t.trim().toLowerCase()) : [],
    kind: isEventOnly ? "event" : "task",
    taskId,
  };

  if (!isEventOnly) {
    tasks.unshift({
      id: taskId,
      title,
      project: flags.project ?? undefined,
      priority,
      status: "active",
      dueDate: flags.date,
      createdAt: new Date().toISOString(),
    });
    await putKey("alphacore_tasks", tasks);
  }

  events.push(event);
  await putKey("alphacore_schedule_custom", events);
  console.info(`✅ Schedule event added: ${title} on ${event.date} ${event.start}–${event.end} (${event.id})${taskId ? ` → task ${taskId}` : ""}`);
}

async function scheduleList(args) {
  const { flags } = parseArgs(args);
  const date = flags.date ?? todayStr();
  const events = (await getKey("alphacore_schedule_custom")) ?? [];
  const filtered = events.filter((e) => e.date === date);

  if (filtered.length === 0) {
    console.info(`📭 No custom events for ${date}.`);
    return;
  }

  console.info(`📅 Custom events for ${date}:\n`);
  for (const e of filtered) {
    const kind = e.kind === "event" ? "event" : "task";
    console.info(`  ${e.start}–${e.end} ${e.title} [${e.tone}/${kind}] (${e.id})${e.taskId ? ` → ${e.taskId}` : ""}`);
  }
}

async function scheduleRemove(args) {
  const { positional } = parseArgs(args);
  const id = positional[0];
  if (!id) {
    console.error("Usage: schedule remove <id>");
    process.exit(1);
  }

  const events = (await getKey("alphacore_schedule_custom")) ?? [];
  const idx = events.findIndex((e) => e.id === id || e.id.startsWith(id));
  if (idx === -1) {
    console.error(`❌ Event not found: ${id}`);
    process.exit(1);
  }

  const tasks = (await getKey("alphacore_tasks")) ?? [];
  const removed = events.splice(idx, 1)[0];
  await putKey("alphacore_schedule_custom", events);
  if (removed?.taskId) {
    await putKey(
      "alphacore_tasks",
      tasks.filter((task) => task.id !== removed.taskId),
    );
  }
  console.info(`✅ Removed: ${removed.title} (${removed.id})`);
}

// ── Clarification-learning commands ─────────────────────────────────────────

async function clarificationAdd(args) {
  const { positional, flags } = parseArgs(args);
  const answer = positional[0];
  const reason = flags.reason;

  if (!answer || !reason || !VALID_CLARIFICATION_REASONS.includes(reason)) {
    console.error(
      `Usage: clarification add "answer" --reason ${VALID_CLARIFICATION_REASONS.join("|")} [--task <id>] [--question-id <id>] [--freeform "..."] [--context-hash <hash>] [--context-mode normal|energy-conflict|overloaded]`,
    );
    process.exit(1);
  }

  const contextMode = flags["context-mode"] ?? "normal";
  if (!VALID_CLARIFICATION_CONTEXT_MODES.includes(contextMode)) {
    console.error(
      `❌ Invalid context mode: ${contextMode}. Valid: ${VALID_CLARIFICATION_CONTEXT_MODES.join(", ")}`,
    );
    process.exit(1);
  }

  const events = (await getKey("alphacore_agent_clarification_feedback")) ?? [];
  const event = {
    id: uid(),
    questionId: flags["question-id"] ?? uid(),
    taskId: flags.task ?? null,
    reason,
    answer,
    freeform: flags.freeform ?? null,
    contextHash: flags["context-hash"] ?? null,
    contextMode,
    createdAt: new Date().toISOString(),
  };

  events.push(event);
  await putKey("alphacore_agent_clarification_feedback", events);
  console.info(
    `✅ Clarification answer saved: ${reason} → ${answer}${event.taskId ? ` (${event.taskId})` : ""}`,
  );
}

async function clarificationList(args) {
  const { flags } = parseArgs(args);
  const limit = flags.limit ? parseInt(flags.limit, 10) : 10;
  const events = (await getKey("alphacore_agent_clarification_feedback")) ?? [];
  const shown = events.slice(-limit);

  if (shown.length === 0) {
    console.info("📭 No clarification answers.");
    return;
  }

  console.info(`🧠 Clarification answers (last ${shown.length}):\n`);
  for (const event of shown) {
    console.info(`  ${event.reason} → ${event.answer}${event.taskId ? ` [${event.taskId}]` : ""}`);
    console.info(`     mode:${event.contextMode} ${event.createdAt} (${event.id})\n`);
  }
}

// ── Snapshot / Brief / Review ────────────────────────────────────────────────

async function snapshotCmd() {
  let data;
  try {
    data = await api("GET", SNAPSHOT);
  } catch {
    console.error("❌ /api/agent-snapshot not available. Falling back to raw storage.");
    const raw = await api("GET", STORAGE);
    console.info(JSON.stringify(raw.items, null, 2));
    return;
  }

  console.info(`\n🎯 ALPHACORE Snapshot — Balance: ${data.balanceScore}/100\n`);
  console.info(`📌 ${data.modeStatement}\n`);
  console.info(`📖 ${data.narrative}\n`);

  if (data.areas?.length) {
    console.info("── Attention Areas ──\n");
    for (const a of data.areas) {
      const bar = "█".repeat(Math.round(a.score / 10)) + "░".repeat(10 - Math.round(a.score / 10));
      console.info(`  ${a.emoji} ${a.label.padEnd(14)} ${bar} ${a.score}  [${a.level}]`);
      console.info(`     ${a.summary}`);
      console.info(`     💡 ${a.insight}\n`);
    }
  }

  if (data.priorities?.length) {
    console.info("── Top Priorities ──\n");
    for (const p of data.priorities) {
      const icon = p.level === "critical" ? "🔴" : p.level === "watch" ? "🟡" : "🟢";
      console.info(`  ${icon} ${p.title}`);
      console.info(`     ${p.reason}`);
      console.info(`     → ${p.action}\n`);
    }
  }
}

async function briefCmd() {
  let data;
  try {
    data = await api("GET", `${SNAPSHOT}?mode=brief`);
  } catch {
    console.info("⏳ Brief endpoint not available yet. Use 'snapshot' instead.");
    return;
  }

  if (data.brief) {
    console.info(data.brief);
  } else {
    await snapshotCmd();
  }
}

async function reviewCmd() {
  let data;
  try {
    data = await api("GET", `${SNAPSHOT}?mode=review`);
  } catch {
    console.info("⏳ Review endpoint not available yet. Use 'snapshot' instead.");
    return;
  }

  if (data.review) {
    console.info(data.review);
  } else {
    await snapshotCmd();
  }
}

// ── Deploy command ────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";

async function deployCmd(args) {
  const { flags } = parseArgs(args);
  const message = flags.message ?? flags.m ?? null;

  console.info("🚀 ALPHACORE deploy — pushing code changes to production…\n");

  // Step 1: type-check
  console.info("① Type-check…");
  try {
    execSync("npm run type-check", { cwd: process.cwd(), stdio: "pipe" });
    console.info("   ✅ No type errors.\n");
  } catch (err) {
    console.error("   ❌ Type-check failed. Fix errors before deploying:\n");
    console.error(err.stdout?.toString() ?? err.stderr?.toString() ?? err.message);
    process.exit(1);
  }

  // Step 2: check for changes
  const status = execSync("git status --porcelain", { cwd: process.cwd(), encoding: "utf-8" }).trim();
  if (!status) {
    console.info("② No uncommitted changes — pushing existing commits.\n");
  } else {
    console.info(`② Staging ${status.split("\n").length} changed file(s)…`);
    execSync("git add -A", { cwd: process.cwd(), stdio: "pipe" });

    // Step 3: commit
    const commitMsg = message ?? autoCommitMessage();
    console.info(`③ Committing: "${commitMsg}"`);
    try {
      execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: process.cwd(), stdio: "pipe" });
      console.info("   ✅ Committed.\n");
    } catch (err) {
      // Nothing to commit (rare edge case after add -A)
      console.info("   ℹ  Nothing to commit.\n");
    }
  }

  // Step 4: push
  console.info("④ Pushing to origin/main…");
  try {
    execSync("git push origin main", { cwd: process.cwd(), stdio: "pipe" });
    console.info("   ✅ Pushed.\n");
  } catch (err) {
    console.error("   ❌ Push failed:\n");
    console.error(err.stderr?.toString() ?? err.message);
    process.exit(1);
  }

  console.info("🎉 Deploy triggered! GitHub Actions will build & deploy to Yandex Cloud.");
  console.info("   PWA will update in ~3 minutes.");
  console.info("   Track progress: https://github.com/kinderlystv-png/ALPHACORE/actions");
}

function autoCommitMessage() {
  try {
    const diff = execSync("git diff --cached --stat", { cwd: process.cwd(), encoding: "utf-8" }).trim();
    const lines = diff.split("\n");
    const summary = lines[lines.length - 1]; // e.g. "3 files changed, 45 insertions(+), 12 deletions(-)"
    return `chore: update — ${summary}`;
  } catch {
    return "chore: update via agent deploy";
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

const HELP = `
ALPHACORE Agent CLI

Usage: npm run alpha -- <command> [args]

Commands:
  task add "title" [--priority p1|p2|p3] [--due YYYY-MM-DD] [--project name]
  task list [--status inbox|active|done] [--limit N]
  task done <id>
  journal add "text" [--tags tag1,tag2] [--author user|assistant]
  journal list [--limit N]
  note add "title" [--body "..."] [--tags tag1,tag2]
  project list
  project status <id|name> <green|yellow|red>
  project next-step <id|name> "step text"
  habit check <id>
  habit status
  medical add "name" --category blood --date YYYY-MM-DD --params "Name:Val:Unit:Min:Max,..."
  schedule add "title" --date YYYY-MM-DD --start HH:MM --end HH:MM [--tone work] [--tags t1,t2] [--priority p1|p2|p3] [--project name] [--event-only]
  schedule list [--date YYYY-MM-DD]
  schedule remove <id>
  clarification add "answer" --reason definition-of-done|timing|slotting|priority|execution-mode [--task <id>] [--question-id <id>] [--freeform "..."] [--context-hash <hash>] [--context-mode normal|energy-conflict|overloaded]
  clarification list [--limit N]
  snapshot
  brief
  review
  deploy [--message "commit message"]   Push code to production
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.info(HELP);
    process.exit(0);
  }

  const domain = args[0];
  const action = args[1];
  const rest = args.slice(2);

  switch (domain) {
    case "task":
      if (action === "add") return taskAdd(rest);
      if (action === "list") return taskList(rest);
      if (action === "done") return taskDone(rest);
      break;
    case "journal":
      if (action === "add") return journalAdd(rest);
      if (action === "list") return journalList(rest);
      break;
    case "note":
      if (action === "add") return noteAdd(rest);
      break;
    case "project":
      if (action === "list") return projectList();
      if (action === "status") return projectStatus(rest);
      if (action === "next-step") return projectNextStep(rest);
      break;
    case "habit":
      if (action === "check") return habitCheck(rest);
      if (action === "status") return habitStatus();
      break;
    case "medical":
      if (action === "add") return medicalAdd(rest);
      break;
    case "schedule":
      if (action === "add") return scheduleAdd(rest);
      if (action === "list") return scheduleList(rest);
      if (action === "remove") return scheduleRemove(rest);
      break;
    case "clarification":
      if (action === "add") return clarificationAdd(rest);
      if (action === "list") return clarificationList(rest);
      break;
    case "snapshot":
      return snapshotCmd();
    case "brief":
      return briefCmd();
    case "review":
      return reviewCmd();
    case "deploy":
      return deployCmd(args.slice(1));
    case "help":
    case "--help":
    case "-h":
      console.info(HELP);
      return;
  }

  console.error(`Unknown command: ${args.join(" ")}`);
  console.info(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
