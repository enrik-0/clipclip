#!/usr/bin/env node
// Crea la compañía "test" (software + filial de vídeo) en una instancia local de Paperclip.
// No asigna tareas: ningún agente se ejecuta hasta que alguien les dé trabajo.
//
//   node experiments/test-org/setup.mjs
//
// Los agentes se crean de uno en uno y se espera a que cada uno quede verificado,
// para no lanzar decenas de procesos de Claude a la vez.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API = (process.env.PAPERCLIP_API ?? "http://localhost:3100").replace(/\/$/, "") + "/api";
const DATA = process.env.TEST_ORG_DATA ?? "D:/proyectos/test-org-data";
const SOFTWARE_DIR = process.env.TEST_SOFTWARE_DIR ?? "D:/proyectos/test-software";
const VIDEO_DIR = process.env.TEST_VIDEO_DIR ?? "D:/proyectos/test-video";
const COMPANY_NAME = "test";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

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

// Reanudable: si la compañía ya existe se reutiliza y solo se crea lo que falte.
const existingCompany = (await call("GET", "/companies")).find((c) => c.name === COMPANY_NAME);

// ---------------- Reglas comunes ----------------
const COMMON = `# Reglas de la compañía "test"

## Cómo trabajamos
- Trabajas por tareas (issues), de una en una. Cambia tú el estado de la tarea con la API/skill de
  Paperclip: \`in_progress\` al empezar, \`in_review\` cuando esté lista para revisión, y solo
  \`done\` si eres quien tiene autoridad para cerrarla.
- Todo deja rastro: termina cada tarea con un comentario que diga qué hiciste y adjunte
  **evidencia real** (salida de comandos, rutas de archivos). Nunca afirmes que algo funciona
  sin haberlo ejecutado.
- Tareas pequeñas y verificables. Si una tarea es demasiado grande, divídela en sub-tareas
  con criterio de aceptación y asígnalas a quien corresponda.

## Costes y gobierno
- Eres consciente del presupuesto: no repitas un intento fallido más de 2 veces; escala a tu jefe
  con el error exacto en vez de insistir.
- No contrates agentes, no gastes fuera de tu presupuesto y no hagas nada irreversible o público
  sin aprobación del board (el humano). Pide aprobación con una interacción, no la des por supuesta.
- Nunca hagas \`git push\` ni publiques nada externamente sin aprobación explícita.
- Si falta información, pregunta a tu responsable o al board; no adivines.

## Entorno
- Windows con PowerShell. Evita comandos Unix (\`find /\`, \`/dev/null\`); usa las herramientas
  de lectura/búsqueda del agente.
`;

// ---------------- Definición de roles ----------------
// reportsTo: clave de otro rol. budget en céntimos de dólar al mes.
const ROLES = [
  {
    key: "ceo", name: "CEO", role: "ceo", title: "Director General", model: SONNET, budget: 2000, turns: 40,
    caps: "Fija prioridades, reparte presupuesto, aprueba el plan y reporta al board.",
    canCreateAgents: true,
    doc: `# CEO
Eres el máximo responsable ejecutivo. Tu foco es **software** (prioritario); la filial de vídeo es
secundaria y solo recibe trabajo cuando el board lo pide.
- Traduce los objetivos del board en iniciativas para el CTO, el PM y el Director de Vídeo.
- Revisa el gasto frente al presupuesto cada vez que cierras una iniciativa y avisa al board si
  vas a pasarte.
- Puedes proponer contrataciones, pero **siempre requieren aprobación del board**.
- No escribas código ni edites vídeo: delega y revisa.`,
  },
  {
    key: "cto", name: "CTO", role: "cto", title: "Director Técnico", model: SONNET, budget: 3000, turns: 40, reportsTo: "ceo",
    caps: "Arquitectura, decisiones técnicas, descomposición de épicas y revisión final del código.",
    doc: `# CTO
- Decide arquitectura y estándares técnicos; documenta cada decisión relevante en una nota breve
  (contexto, decisión, consecuencias).
- Convierte las épicas del PM en tareas técnicas pequeñas para Backend, Frontend, QA y DevOps,
  con criterio de aceptación ejecutable.
- Eres el revisor final del código: revisa el diff, ejecuta las pruebas y solo entonces cierra.
- Devuelve el trabajo con **un único motivo claro** y la corrección mínima pedida.`,
  },
  {
    key: "pm", name: "Product Manager", role: "pm", title: "Responsable de Producto", model: SONNET, budget: 1500, turns: 30, reportsTo: "ceo",
    caps: "Especificaciones, backlog priorizado y criterios de aceptación.",
    doc: `# Product Manager
- Convierte los objetivos en historias de usuario con criterios de aceptación verificables.
- Mantén el backlog priorizado (valor frente a coste). Una historia = un resultado observable.
- No decides la solución técnica: eso es del CTO. Tu entregable son especificaciones claras,
  no código.`,
  },
  {
    key: "backend", name: "Ingeniero Backend", role: "engineer", title: "Ingeniero Backend", model: SONNET, budget: 2500, turns: 50, reportsTo: "cto",
    caps: "Servidor, APIs, base de datos y lógica de negocio.",
    doc: `# Ingeniero Backend
- Implementa tareas de servidor/API/datos siguiendo la arquitectura del CTO.
- Escribe primero el test, luego el código (rojo → verde), y adjunta la salida de ambos.
- Cambios pequeños y revisables (≤ 300 líneas por tarea). Pasa la tarea a \`in_review\` al terminar.`,
  },
  {
    key: "frontend", name: "Ingeniero Frontend", role: "engineer", title: "Ingeniero Frontend", model: SONNET, budget: 2500, turns: 50, reportsTo: "cto",
    caps: "Interfaz de usuario, componentes, accesibilidad y experiencia.",
    doc: `# Ingeniero Frontend
- Implementa interfaces siguiendo las especificaciones del PM y la arquitectura del CTO.
- Reutiliza componentes existentes antes de crear nuevos; mantén accesibilidad básica.
- Adjunta evidencia (captura o descripción verificable) y la salida de los tests. Pasa a \`in_review\`.`,
  },
  {
    key: "qa", name: "QA", role: "qa", title: "Ingeniero de Calidad", model: HAIKU, budget: 1000, turns: 30, reportsTo: "cto",
    caps: "Pruebas, reproducción de bugs y verificación de criterios de aceptación.",
    doc: `# QA
- Verifica cada tarea contra su criterio de aceptación ejecutando las pruebas, no leyendo el código.
- Reporta bugs con pasos de reproducción exactos, resultado esperado y obtenido.
- No arregles código de producción: devuelve el hallazgo al ingeniero responsable.`,
  },
  {
    key: "devops", name: "DevOps", role: "devops", title: "Ingeniero DevOps", model: HAIKU, budget: 1000, turns: 30, reportsTo: "cto",
    caps: "Entornos, CI/CD, empaquetado y despliegues.",
    doc: `# DevOps
- Mantén los entornos y el pipeline reproducibles y documentados.
- Cualquier despliegue o cambio de infraestructura real requiere **aprobación del board** antes de ejecutarse.
- Prefiere cambios reversibles y deja siempre la forma de revertir.`,
  },
  {
    key: "video_director", name: "Director de Vídeo", role: "cmo", title: "Director de la Filial de Vídeo", model: SONNET, budget: 1500, turns: 40, reportsTo: "ceo",
    caps: "Dirige la filial de vídeo: planifica producciones, reparte tareas y controla calidad.",
    doc: `# Director de Vídeo
Diriges la filial de vídeo (secundaria frente al software).
- Convierte cada petición en una producción: guion → edición → revisión → publicación.
- Cada producción tiene un brief (objetivo, duración, tono, audiencia) antes de empezar.
- **Nada se publica sin aprobación del board**: prepara el paquete final (vídeo, título, descripción,
  miniatura) y pídela con una interacción.`,
  },
  {
    key: "scriptwriter", name: "Guionista", role: "designer", title: "Guionista", model: SONNET, budget: 1000, turns: 30, reportsTo: "video_director",
    caps: "Escribe guiones, ganchos, estructura y textos de apoyo.",
    doc: `# Guionista
- Escribe el guion a partir del brief: gancho en los primeros segundos, estructura clara y cierre.
- Entrega guion + lista de planos/recursos necesarios. Respeta la duración del brief.
- No inventes datos ni cites fuentes que no hayas verificado.`,
  },
  {
    key: "editor", name: "Editor de Vídeo", role: "designer", title: "Editor de Vídeo", model: HAIKU, budget: 800, turns: 30, reportsTo: "video_director",
    caps: "Montaje, subtítulos, audio y exportación.",
    doc: `# Editor de Vídeo
- Monta el vídeo a partir del guion y los recursos disponibles, y exporta en el formato pedido.
- Usa solo las herramientas instaladas en el equipo; si falta alguna (p. ej. ffmpeg), dilo en un
  comentario y marca la tarea como bloqueada, no improvises.
- Adjunta el archivo final y su ruta como entregable.`,
  },
  {
    key: "publisher", name: "Publicador", role: "general", title: "Responsable de Publicación", model: HAIKU, budget: 500, turns: 20, reportsTo: "video_director",
    caps: "Prepara metadatos y publica los vídeos aprobados.",
    doc: `# Publicador
- Prepara título, descripción, etiquetas y miniatura de cada vídeo aprobado.
- **Nunca publiques sin una aprobación explícita del board para ese vídeo concreto.** Si no hay
  credenciales o acceso al canal, deja el paquete listo y comunícalo: no lo simules.`,
  },
];

// ---------------- 1. Compañía ----------------
const company =
  existingCompany ??
  (await call("POST", "/companies", {
    name: COMPANY_NAME,
    description:
      "Compañía de software (prioritaria) con una filial de vídeo. Software: CEO, CTO, PM, Backend, Frontend, QA y DevOps. Vídeo: dirección, guion, edición y publicación (con aprobación del board).",
    budgetMonthlyCents: 20000,
  }));
console.log(existingCompany ? "Compañía (reutilizada):" : "Compañía:", company.id);

// ---------------- 2. Proyectos ----------------
await mkdir(SOFTWARE_DIR, { recursive: true });
await mkdir(VIDEO_DIR, { recursive: true });
const existingProjects = existingCompany ? await call("GET", `/companies/${company.id}/projects`) : [];
const software =
  existingProjects.find((p) => p.name === "Software") ??
  (await call("POST", `/companies/${company.id}/projects`, {
    name: "Software",
    description: "Producto de software de la compañía.",
    status: "in_progress",
    workspace: { name: "test-software", sourceType: "local_path", cwd: SOFTWARE_DIR, isPrimary: true },
  }));
const video =
  existingProjects.find((p) => p.name === "Vídeo Studio") ??
  (await call("POST", `/companies/${company.id}/projects`, {
    name: "Vídeo Studio",
    description: "Producciones de la filial de vídeo (guion, edición, publicación).",
    status: "backlog",
    workspace: { name: "test-video", sourceType: "local_path", cwd: VIDEO_DIR, isPrimary: true },
  }));
console.log("Proyectos:", software.id, video.id);

// ---------------- 3. Agentes (uno a uno, esperando verificación) ----------------
const runtimeConfig = {
  heartbeat: { enabled: false, intervalSec: 0, wakeOnAssignment: true, wakeOnDemand: true, wakeOnAutomation: false, maxConcurrentRuns: 1 },
};
const ids = {};
const existingAgents = existingCompany ? await call("GET", `/companies/${company.id}/agents`) : [];
for (const r of ROLES) {
  const already = existingAgents.find((a) => a.name === r.name);
  if (already) {
    ids[r.key] = already.id;
    console.log(`${r.name.padEnd(20)} (ya existía)`);
    continue;
  }
  // En Windows la sonda de verificación de Paperclip lanza `claude` con un entorno vacío:
  //  - CLAUDE_CONFIG_DIR (permitida por la sonda) le indica dónde está el login de Claude;
  //  - --append-system-prompt evita que responda "¡Hola!" en vez de "hello" y falle la sonda.
  const adapterConfig = {
    engine: "cli",
    model: r.model,
    maxTurnsPerRun: r.turns,
    timeoutSec: 0,
    graceSec: 30,
    env: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? "C:/Users/villa/.claude" },
    extraArgs: ["--append-system-prompt", "Si te piden responder con una palabra concreta, responde exactamente con esa palabra y nada más."],
  };
  if (r.model === SONNET) adapterConfig.effort = "medium";
  const agent = await call("POST", `/companies/${company.id}/agents`, {
    name: r.name,
    role: r.role,
    title: r.title,
    capabilities: r.caps,
    reportsTo: r.reportsTo ? ids[r.reportsTo] : null,
    adapterType: "claude_local",
    adapterConfig,
    runtimeConfig,
    budgetMonthlyCents: r.budget,
    permissions: { canCreateAgents: r.canCreateAgents === true },
    instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": `${COMMON}\n---\n\n${r.doc}\n` } },
  });
  ids[r.key] = agent.id;
  console.log(`${r.name.padEnd(20)} ${r.model.padEnd(18)} $${(r.budget / 100).toFixed(0).padStart(3)}  creado`);
  // La sonda automática de cada agente es un proceso de Claude: se espacian para no saturar el PC.
  await sleep(20000);
}

// Nota: cada agente recién creado pasa una verificación automática (una sonda de `claude`).
// Si alguno queda en paused/verifying, cambia algo inocuo de su adapterConfig (p. ej. graceSec)
// para forzar una nueva sonda.

// ---------------- 4. Gobierno ----------------
await call("PATCH", `/companies/${company.id}`, { requireBoardApprovalForNewAgents: true });
console.log("Gobierno: contrataciones nuevas requieren aprobación del board.");

await mkdir(DATA, { recursive: true });
await writeFile(path.join(DATA, "ids.json"), JSON.stringify({ companyId: company.id, projects: { software: software.id, video: video.id }, agents: ids }, null, 2));
console.log(`\nListo. IDs en ${path.join(DATA, "ids.json")}\nUI: ${API.replace(/\/api$/, "")}`);
