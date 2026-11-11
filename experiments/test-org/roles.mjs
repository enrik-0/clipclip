// Definición de la organización "test": metadatos de los roles. Las instrucciones de cada agente
// viven en ./agents/<clave>.md y las reglas comunes en ./agents/_common.md (la mecánica de Paperclip
// no se repite: la define la skill `paperclip`).

import { readFileSync } from "node:fs";

const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

const read = (file) => readFileSync(new URL(`./agents/${file}`, import.meta.url), "utf8");

export const COMMON = read("_common.md");

// reportsTo: clave de otro rol. budget en céntimos de dólar al mes.
const ROLE_META = [
  { key: "ceo", name: "CEO", role: "ceo", title: "Director General", model: SONNET, budget: 2000, turns: 40, canCreateAgents: true,
    caps: "Fija prioridades, reparte presupuesto, arranca proyectos y reporta al board." },
  { key: "cto", name: "CTO", role: "cto", title: "Director Técnico", model: SONNET, budget: 3000, turns: 40, reportsTo: "ceo",
    caps: "Arquitectura, decisiones técnicas, descomposición de épicas y aprobación final del código." },
  { key: "pm", name: "Product Manager", role: "pm", title: "Responsable de Producto", model: SONNET, budget: 1500, turns: 30, reportsTo: "ceo",
    caps: "PRODUCT.md, historias de usuario, backlog priorizado y criterios de aceptación." },
  { key: "backend", name: "Ingeniero Backend", role: "engineer", title: "Ingeniero Backend", model: SONNET, budget: 2500, turns: 50, reportsTo: "cto",
    caps: "Servidor, APIs, base de datos y lógica de negocio." },
  { key: "frontend", name: "Ingeniero Frontend", role: "engineer", title: "Ingeniero Frontend", model: SONNET, budget: 2500, turns: 50, reportsTo: "cto",
    caps: "Interfaz de usuario, componentes, accesibilidad y experiencia." },
  { key: "reviewer", name: "Revisor de Código", role: "engineer", title: "Revisor de Código", model: SONNET, budget: 2000, turns: 40, reportsTo: "cto",
    caps: "Primera revisión del diff de cada tarea antes de que llegue al CTO." },
  { key: "qa", name: "QA", role: "qa", title: "Ingeniero de Calidad", model: HAIKU, budget: 1000, turns: 30, reportsTo: "cto",
    caps: "Estrategia de pruebas, reproducción de bugs y verificación de criterios de aceptación." },
  { key: "security", name: "Seguridad", role: "security", title: "Responsable de Seguridad", model: SONNET, budget: 1500, turns: 30, reportsTo: "cto",
    caps: "Modelo de amenazas y revisión de seguridad de los cambios sensibles." },
  { key: "devops", name: "DevOps", role: "devops", title: "Ingeniero DevOps", model: HAIKU, budget: 1000, turns: 30, reportsTo: "cto",
    caps: "Repositorio, entornos, scripts de verificación y despliegues (con aprobación)." },
  { key: "video_director", name: "Director de Vídeo", role: "cmo", title: "Director de la Filial de Vídeo", model: SONNET, budget: 1500, turns: 40, reportsTo: "ceo",
    caps: "Dirige la filial de vídeo: planifica producciones, reparte tareas y controla la calidad." },
  { key: "scriptwriter", name: "Guionista", role: "designer", title: "Guionista", model: SONNET, budget: 1000, turns: 30, reportsTo: "video_director",
    caps: "Escribe guiones, ganchos, estructura y textos de apoyo." },
  { key: "editor", name: "Editor de Vídeo", role: "designer", title: "Editor de Vídeo", model: HAIKU, budget: 800, turns: 30, reportsTo: "video_director",
    caps: "Montaje, subtítulos, audio y exportación." },
  { key: "publisher", name: "Publicador", role: "general", title: "Responsable de Publicación", model: HAIKU, budget: 500, turns: 20, reportsTo: "video_director",
    caps: "Prepara metadatos y publica los vídeos aprobados." },
];

export const ROLES = ROLE_META.map((r) => ({ ...r, doc: read(`${r.key}.md`).trim() }));

// Metas de la compañía (nivel company y team). parent: índice de la meta padre.
export const GOALS = [
  {
    title: "Entregar software funcional, probado y seguro dentro del presupuesto",
    level: "company", owner: "ceo",
    description: "Meta global de la compañía. La filial de vídeo es una actividad secundaria.",
  },
  {
    title: "Software: arrancar el proyecto (producto, arquitectura, repositorio y estrategia de pruebas)",
    level: "team", owner: "cto", parent: 0,
    description: "PRODUCT.md aprobado, ADR-0001, repo preparado con CONTRIBUTING.md y docs/PRUEBAS.md.",
  },
  {
    title: "Filial de vídeo: guía de marca y flujo de producción listos",
    level: "team", owner: "video_director", parent: 0,
    description: "brand.md, plantilla de brief y lista de herramientas necesarias; sin publicar nada aún.",
  },
];
