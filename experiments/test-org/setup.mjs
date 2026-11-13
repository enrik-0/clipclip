#!/usr/bin/env node
// Crea o sincroniza la compañía "test" (software + filial de vídeo) en una instancia local de Paperclip.
// Es idempotente: se puede ejecutar de nuevo y solo crea lo que falte y actualiza las instrucciones.
// No asigna tareas: ningún agente se ejecuta hasta que alguien les dé trabajo.
//
//   node experiments/test-org/setup.mjs

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { COMMON, ROLES, GOALS } from "./roles.mjs";

const API = (process.env.PAPERCLIP_API ?? "http://localhost:3100").replace(/\/$/, "") + "/api";
const DATA = process.env.TEST_ORG_DATA ?? "D:/proyectos/test-org-data";
const SOFTWARE_DIR = process.env.TEST_SOFTWARE_DIR ?? "D:/proyectos/test-software";
const VIDEO_DIR = process.env.TEST_VIDEO_DIR ?? "D:/proyectos/test-video";
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
const COMPANY_NAME = "test";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  return json;
}
const list = (x) => (Array.isArray(x) ? x : x?.items ?? []);
const instructionsFor = (r) => `${COMMON}\n---\n\n${r.doc}\n`;

// En Windows la sonda de verificación de Paperclip lanza `claude` con un entorno vacío:
//  - CLAUDE_CONFIG_DIR (permitida por la sonda) le indica dónde está el login de Claude;
//  - --append-system-prompt evita que responda "¡Hola!" en vez de "hello" y falle la sonda.
const buildAdapterConfig = (r) => ({
  engine: "cli",
  model: r.model,
  ...(r.model.includes("sonnet") ? { effort: "medium" } : {}),
  timeoutSec: 0,
  graceSec: 30,
  // No cargar plugins, skills, hooks ni MCP personales del operador (las credenciales siguen valiendo).
  isolatePersonalConfig: true,
  env: { CLAUDE_CONFIG_DIR },
  extraArgs: ["--append-system-prompt", "Si te piden responder con una palabra concreta, responde exactamente con esa palabra y nada más."],
});

async function waitReady(id, seconds) {
  for (let i = 0; i < seconds / 3; i++) {
    const a = await call("GET", `/agents/${id}`);
    if (a.lifecycleState === "ready") return true;
    await sleep(3000);
  }
  return false;
}
// La sonda puede fallar de forma intermitente: un cambio inocuo (graceSec) fuerza otra.
async function ensureReady(id, name) {
  if (await waitReady(id, 75)) return "idle/ready";
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await call("GET", `/agents/${id}`);
    const cfg = { ...a.adapterConfig, graceSec: a.adapterConfig.graceSec === 31 ? 30 : 31 };
    await call("PATCH", `/agents/${id}`, { adapterConfig: cfg });
    if (await waitReady(id, 75)) return "idle/ready";
  }
  const a = await call("GET", `/agents/${id}`);
  return `${a.status}/${a.lifecycleState} (revisar ${name} en la UI)`;
}

// ---------------- 1. Compañía y proyectos ----------------
const existingCompany = list(await call("GET", "/companies")).find((c) => c.name === COMPANY_NAME);
const company =
  existingCompany ??
  (await call("POST", "/companies", {
    name: COMPANY_NAME,
    description:
      "Compañía de software (prioritaria) con una filial de vídeo. Software: CEO, CTO, PM, Backend, Frontend, Revisor de Código, QA, Seguridad y DevOps. Vídeo: dirección, guion, edición y publicación (con aprobación del board).",
    budgetMonthlyCents: 20000,
  }));
console.log(existingCompany ? "Compañía (reutilizada):" : "Compañía creada:", company.id);

await mkdir(SOFTWARE_DIR, { recursive: true });
await mkdir(VIDEO_DIR, { recursive: true });
const projects = existingCompany ? list(await call("GET", `/companies/${company.id}/projects`)) : [];
const software =
  projects.find((p) => p.name === "Software") ??
  (await call("POST", `/companies/${company.id}/projects`, {
    name: "Software",
    description: "Producto de software de la compañía.",
    status: "in_progress",
    workspace: { name: "test-software", sourceType: "local_path", cwd: SOFTWARE_DIR, isPrimary: true },
  }));
const video =
  projects.find((p) => p.name === "Vídeo Studio") ??
  (await call("POST", `/companies/${company.id}/projects`, {
    name: "Vídeo Studio",
    description: "Producciones de la filial de vídeo (guion, edición, publicación).",
    status: "backlog",
    workspace: { name: "test-video", sourceType: "local_path", cwd: VIDEO_DIR, isPrimary: true },
  }));

// ---------------- 2. Agentes: crear los que falten, sincronizar instrucciones ----------------
// El operador humano crea los agentes: se suspende la aprobación solo durante este bloque y se
// restaura siempre en el `finally`.
const ids = {};
const goalIds = [];
await call("PATCH", `/companies/${company.id}`, { requireBoardApprovalForNewAgents: false });
try {
const runtimeConfig = {
  heartbeat: { enabled: false, intervalSec: 0, wakeOnAssignment: true, wakeOnDemand: true, wakeOnAutomation: false, maxConcurrentRuns: 1 },
};
const existingAgents = list(await call("GET", `/companies/${company.id}/agents`));
for (const r of ROLES) {
  const found = existingAgents.find((a) => a.name === r.name);
  if (found) {
    ids[r.key] = found.id;
    const cur = await call("GET", `/agents/${found.id}/instructions-bundle/file?path=AGENTS.md`);
    const next = instructionsFor(r);
    if ((cur.content ?? "") === next) {
      console.log(`${r.name.padEnd(20)} instrucciones al día`);
    } else {
      await call("PUT", `/agents/${found.id}/instructions-bundle/file`, {
        path: "AGENTS.md",
        content: next,
        baseRevisionId: cur.revisionId ?? cur.revision?.id ?? null,
      });
      console.log(`${r.name.padEnd(20)} instrucciones actualizadas`);
    }
    // Sin límite de turnos para nadie: se elimina maxTurnsPerRun si existiera (cambiar el adapterConfig relanza la sonda).
    const current = await call("GET", `/agents/${found.id}`);
    // (el PATCH fusiona la configuración: borrar la clave no sirve; 0 = sin `--max-turns`)
    if (current.adapterConfig && Number(current.adapterConfig.maxTurnsPerRun ?? 0) !== 0) {
      await call("PATCH", `/agents/${found.id}`, { adapterConfig: { ...current.adapterConfig, maxTurnsPerRun: 0 } });
      console.log(`${r.name.padEnd(20)} sin límite de turnos → ${await ensureReady(found.id, r.name)}`);
    }
    if ((found.budgetMonthlyCents ?? 0) !== r.budget) {
      await call("PATCH", `/agents/${found.id}`, { budgetMonthlyCents: r.budget });
      console.log(`${r.name.padEnd(20)} presupuesto mensual → ${r.budget} (0 = sin tope)`);
    }
    continue;
  }
  const agent = await call("POST", `/companies/${company.id}/agents`, {
    name: r.name,
    role: r.role,
    title: r.title,
    capabilities: r.caps,
    reportsTo: r.reportsTo ? ids[r.reportsTo] : null,
    adapterType: "claude_local",
    adapterConfig: buildAdapterConfig(r),
    runtimeConfig,
    budgetMonthlyCents: r.budget,
    permissions: { canCreateAgents: r.canCreateAgents === true },
    instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": instructionsFor(r) } },
  });
  ids[r.key] = agent.id;
  const state = await ensureReady(agent.id, r.name);
  console.log(`${r.name.padEnd(20)} ${r.model.padEnd(18)} $${(r.budget / 100).toFixed(0).padStart(3)}  creado → ${state}`);
  await sleep(10000); // una sonda de Claude cada vez, para no cargar el PC
}

// ---------------- 3. Metas ----------------
const existingGoals = list(await call("GET", `/companies/${company.id}/goals`));
for (const g of GOALS) {
  const found = existingGoals.find((x) => x.title === g.title);
  if (found) { goalIds.push(found.id); continue; }
  const created = await call("POST", `/companies/${company.id}/goals`, {
    title: g.title,
    description: g.description,
    level: g.level,
    status: "active",
    ownerAgentId: ids[g.owner],
    parentId: g.parent === undefined ? null : goalIds[g.parent],
  });
  goalIds.push(created.id);
  console.log(`Meta creada: ${g.title}`);
}

} finally {
  await call("PATCH", `/companies/${company.id}`, { requireBoardApprovalForNewAgents: true });
}

// ---------------- 4. Gobierno ----------------
// Se trabaja con suscripción: sin tope de gasto en $ (0 = sin tope) para que ningún agente se pause por presupuesto.
await call("PATCH", `/companies/${company.id}`, { requireBoardApprovalForNewAgents: true, budgetMonthlyCents: 0 });
console.log("Gobierno: contrataciones nuevas requieren aprobación del board.");

await mkdir(DATA, { recursive: true });
await writeFile(
  path.join(DATA, "ids.json"),
  JSON.stringify({ companyId: company.id, projects: { software: software.id, video: video.id }, agents: ids, goals: goalIds }, null, 2),
);
console.log(`\nListo. IDs en ${path.join(DATA, "ids.json")}\nUI: ${API.replace(/\/api$/, "")}`);
