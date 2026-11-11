#!/usr/bin/env node
// Crea la organización del experimento "LFM Swarm Lab" en una instancia local de Paperclip.
//
//   node experiments/lfm-swarm/setup.mjs            # crea todo
//   PAPERCLIP_API=http://localhost:3100 node ...    # otra instancia
//
// Idempotencia: si ya existe una compañía con ese nombre, aborta sin tocar nada.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.PAPERCLIP_API ?? "http://localhost:3100").replace(/\/$/, "") + "/api";
const LAB_REPO = process.env.LAB_REPO ?? "D:/proyectos/paperclip-lab";
const LAB_DATA = process.env.LAB_DATA ?? "D:/proyectos/paperclip-lab-data";
const COMPANY_NAME = "LFM Swarm Lab";
const LFM_MODEL = "lmstudio/lfm3-omni-2b";
const CLAUDE_MODEL = process.env.ORCHESTRATOR_MODEL ?? "claude-sonnet-5-5";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(path.join(here, p), "utf8");

async function call(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`${method} ${route} -> ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

const existing = await call("GET", "/companies");
if (existing.some((c) => c.name === COMPANY_NAME)) {
  console.error(`Ya existe la compañía "${COMPANY_NAME}". No se cambia nada.`);
  process.exit(1);
}

// ---------- Configuración de runtime de los LFM (OpenCode + LM Studio + MCP) ----------
const providers = JSON.stringify(JSON.parse(await read("config/providers.json")));
const mcpConfig = JSON.stringify(JSON.parse(await read("config/opencode-mcp.json")));
const lfmEnv = {
  PAPERCLIP_OPENCODE_PROVIDERS: providers,
  PAPERCLIP_OPENCODE_SMALL_MODEL: LFM_MODEL, // evita que OpenCode pida un modelo "small" que LM Studio no sirve
  OPENCODE_CONFIG_CONTENT: mcpConfig,
};

const common = await read("agents/lfm-common.md");
const orchestratorDoc = await read("agents/orchestrator.md");

// Los agentes solo despiertan por asignación u orden manual: sin timers ociosos.
const runtimeConfig = {
  heartbeat: { enabled: false, intervalSec: 0, wakeOnAssignment: true, wakeOnDemand: true, wakeOnAutomation: false },
};

// ---------- 1. Compañía ----------
const company = await call("POST", "/companies", {
  name: COMPANY_NAME,
  description:
    "Experimento: un orquestador Claude coordina varios agentes LFM especializados para mejorar el propio código de Paperclip.",
  budgetMonthlyCents: 5000,
});
console.log("Compañía:", company.id);

// ---------- 2. Proyecto con workspaces aislados (git worktree por tarea) ----------
await mkdir(path.join(LAB_DATA, "worktrees"), { recursive: true });
const project = await call("POST", `/companies/${company.id}/projects`, {
  name: "Paperclip Lab",
  description: "Copia local de Paperclip (rama lab/experiment, sin remoto) que los agentes pueden modificar.",
  status: "in_progress",
  workspace: { name: "paperclip-lab", sourceType: "local_path", cwd: LAB_REPO, isPrimary: true },
  executionWorkspacePolicy: {
    enabled: true,
    defaultMode: "isolated_workspace",
    allowIssueOverride: false,
    workspaceStrategy: {
      type: "git_worktree",
      worktreeParentDir: path.join(LAB_DATA, "worktrees").replaceAll("\\", "/"),
    },
  },
});
console.log("Proyecto:", project.id);

// ---------- 3. Orquestador Claude ----------
const ceo = await call("POST", `/companies/${company.id}/agents`, {
  name: "Orquestador",
  role: "ceo",
  title: "Orquestador (Claude)",
  capabilities: "Divide el trabajo en tareas mínimas, delega en los LFM, revisa diffs y registra resultados.",
  adapterType: "claude_local",
  adapterConfig: {
    engine: "cli",
    model: CLAUDE_MODEL,
    effort: "medium",
    maxTurnsPerRun: 40,
    timeoutSec: 1800,
    graceSec: 30,
  },
  runtimeConfig,
  budgetMonthlyCents: 2500,
  permissions: { canCreateAgents: false },
  instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": orchestratorDoc } },
});
console.log("Orquestador:", ceo.id);

// ---------- 4. Especialistas LFM ----------
const specialists = [
  { key: "lfm-tests", name: "LFM Tests", role: "qa", title: "Especialista en tests", cap: "Escribe y arregla tests unitarios Vitest." },
  { key: "lfm-docs", name: "LFM Docs", role: "general", title: "Especialista en documentación", cap: "Documenta código existente (JSDoc, README, índices)." },
  { key: "lfm-refactor", name: "LFM Refactor", role: "engineer", title: "Especialista en refactors", cap: "Extracciones y limpiezas seguras sin cambiar comportamiento." },
  { key: "lfm-bugfix", name: "LFM Bugfix", role: "engineer", title: "Especialista en bugs acotados", cap: "Corrige bugs pequeños con TDD." },
];

const agents = { orchestrator: ceo.id };
for (const s of specialists) {
  const roleDoc = await read(`agents/${s.key}.md`);
  const agent = await call("POST", `/companies/${company.id}/agents`, {
    name: s.name,
    role: s.role,
    title: s.title,
    capabilities: s.cap,
    reportsTo: ceo.id,
    adapterType: "opencode_local",
    adapterConfig: {
      model: LFM_MODEL,
      timeoutSec: 1200,
      graceSec: 30,
      env: lfmEnv,
    },
    runtimeConfig,
    budgetMonthlyCents: 0,
    permissions: { canCreateAgents: false },
    instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": `${common}\n\n---\n\n${roleDoc}` } },
  });
  agents[s.key] = agent.id;
  console.log(`${s.name}:`, agent.id);
}

// ---------- 5. Gobierno: nuevos agentes requieren aprobación del board ----------
await call("PATCH", `/companies/${company.id}`, { requireBoardApprovalForNewAgents: true });

// ---------- 6. Tarea inicial para el orquestador ----------
const issue = await call("POST", `/companies/${company.id}/issues`, {
  title: "Ronda 1: encontrar y delegar 5 mejoras pequeñas en Paperclip",
  description: [
    "Objetivo: comprobar qué tipos de trabajo pueden hacer fiablemente los LFM.",
    "",
    "1. Lee `doc/CODEBASE-CONTEXT.md` y explora el repo.",
    "2. Elige **5 mejoras pequeñas** (al menos 1 de cada: tests, docs, refactor; el resto a tu criterio).",
    "3. Crea una issue hija por mejora con ruta exacta, cambio concreto, comando de aceptación y qué NO tocar.",
    "4. Asigna cada una al LFM adecuado, revisa los diffs al volver y anota todo en `experiment-log.md`.",
    "5. Al terminar la ronda, deja un resumen de aprendizajes y propón la ronda 2.",
  ].join("\n"),
  status: "todo",
  priority: "high",
  projectId: project.id,
  assigneeAgentId: ceo.id,
});
console.log("Tarea inicial:", issue.id ?? issue.identifier);

await mkdir(LAB_DATA, { recursive: true });
await writeFile(
  path.join(LAB_DATA, "ids.json"),
  JSON.stringify({ companyId: company.id, projectId: project.id, agents, issueId: issue.id }, null, 2),
);
console.log(`\nListo. IDs guardados en ${path.join(LAB_DATA, "ids.json")}`);
console.log(`UI: ${API.replace(/\/api$/, "")}`);
