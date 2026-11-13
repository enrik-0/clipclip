# Contexto del código base (mapa para mejorar el sistema)

> Documento de orientación, escrito el 2026-11-11 a partir de una revisión del repo.
> Es **contexto de trasfondo**: el código y los tests son la fuente de verdad
> (ver `AGENTS.md` §1). Si algo aquí contradice el código, gana el código.

## 1. Qué es

Paperclip es un **plano de control para compañías de agentes de IA**: org charts,
tareas (issues), heartbeats/runs, presupuestos, aprobaciones, auditoría. No ejecuta
agentes por sí mismo: los orquesta vía *adapters* (Claude, Codex, Gemini, Cursor,
OpenCode, Pi, Grok, Hermes, OpenClaw…) o vía el **Paperclip Runner** nativo
(sandboxes: E2B, Cloudflare, Daytona, Modal, Novita, Kubernetes).
Lectura de producto: `doc/GOAL.md`, `doc/PRODUCT.md`, `ROADMAP.md`.

## 2. Mapa del repo

| Ruta | Contenido |
| --- | --- |
| `server/` | API Express + servicios de orquestación (`src/routes` ≈ HTTP, `src/services` ≈ ~1.300 archivos, dominio) |
| `ui/` | React + Vite (Tailwind v4, tokens en `ui/src/index.css`), Storybook |
| `packages/db` | Esquema Drizzle (~187 tablas), ~464 migraciones, clientes |
| `packages/shared` | Tipos, constantes, validadores, rutas API compartidas |
| `packages/adapters/*` | Un adapter por runtime (`AUTHORING.md` explica cómo crear uno) |
| `packages/adapter-utils` | Utilidades comunes de adapters, motor ACPX |
| `packages/paperclip-runner` | Runner nativo, perfiles ACPX, protocolo |
| `packages/plugins/*` | SDK de plugins, proveedores de sandbox, ejemplos |
| `packages/skills-catalog`, `teams-catalog` | Catálogos incluidos en la app |
| `packages/mcp-server` (+ otros MCP) | Servidores MCP |
| `cli/` | CLI `paperclipai` |
| `skills/` | Skills operativas de runtime (no son el catálogo) |
| `rules/*.mdc` | Reglas de arquitectura que aplican los revisores de PR |
| `maps/` | Feature map, agent-access map, storybook map (opcionales) |
| `tests/` | e2e, release-smoke, restart-chaos, runner-*, perf, etc. |
| `scripts/` | Verificación incremental, benchmarks, release, checks |
| `doc/` | Docs operativos (muchos `idle-*.md` para trabajo de fondo, `plans/` con fechas) |

Escala aproximada: ~4.500 archivos de test, ~7.500 commits, repo muy activo
(decenas de commits `fix(...)` por día, sobre todo en `native`, `recovery`, `workspaces`).

## 3. Invariantes que no se rompen (AGENTS.md §5)

1. **Todo con alcance de compañía** (company-scoped); excepciones listadas en
   `rules/company-scope-exceptions.mdc`.
2. **Contratos sincronizados**: `packages/db` → `packages/shared` → `server` → `ui`.
3. **Control-plane**: un único assignee por tarea, checkout atómico, aprobaciones
   para acciones gobernadas, auto-pausa por presupuesto, activity log en mutaciones.
4. **Comportamiento con su módulo dueño**; contratos compartidos estrechos
   (`rules/module-boundaries.mdc`).
5. **El harness hace lo rutinario** (reintentos, reconexión, finalización);
   no convertir huecos de orquestación en checklists para el usuario
   (`rules/product-harness-responsibility.mdc`).

## 4. Reglas con globs que más condicionan los cambios

- `api-route-expectations`: rutas validan acceso de compañía + permisos, loguean
  mutaciones, errores HTTP consistentes.
- `heartbeat-execution-boundaries`: `heartbeat.ts` es coordinador de ciclo de vida;
  la lógica va en módulos cohesivos bajo `services/heartbeat/`.
- `sleep-aware-background-work`: **no añadir polling ocioso**; trabajo dirigido por
  eventos, deadlines compartidos, recuperable tras suspensión (ver `doc/idle-*.md`).
- `upgrade-safe-run-state`: estado de runs/sesiones guardado por una versión debe
  reanudar en la siguiente o fallar con código permanente y nombrado.
- `runtime-dependency-boundaries`, `data-paths` (Telemetry ≠ Observability ≠ run log),
  `ui-render-cost`, `database-migration-snapshots` (conservar 5 snapshots Drizzle),
  `chat-channel-platform-boundaries`, `acpx-profile-identity`.
- `pull-request-review`: plantilla de PR completa; justificar archivos >1.000 líneas.

Listar cabeceras: `grep -E '^(description|globs|alwaysApply):' rules/*.mdc`.

## 5. Flujo de trabajo

```sh
node scripts/agent-preflight.mjs   # preparar worktree
pnpm dev                           # API + UI en http://localhost:3100 (BD embebida si DATABASE_URL no está definida)
pnpm verify                        # tests afectados + checks cacheados (exit 2 = necesita cobertura más amplia)
pnpm db:generate                   # tras editar el esquema, luego typecheck
node scripts/check-maps.mjs        # solo si se editan maps/
pnpm check:module-boundaries | check:token-gates | check:tokens
```

- Bugs: TDD rojo→verde (reproducir, test que falla, fix, confirmar).
- No ejecutar typecheck/build/test globales por defecto; CI cubre la revisión final.
- UI: seguir `DESIGN.md` (solo tokens; término canónico *task*; footers de formularios).
- Skill local útil: `design-guide`.

## 6. Hallazgos de la revisión (puntos donde mejorar)

Observaciones objetivas del estado actual — candidatas, no decisiones tomadas:

1. **Archivos gigantes** (contra la regla de 1.000 líneas):
   `server/src/routes/issues.ts` (~21.100 líneas),
   `server/src/services/native-runtime/native-session-executor.ts` (~18.000),
   `server/src/services/issues.ts` (~14.700). Son los mayores candidatos a
   extracción por módulo dueño, sin cambiar comportamiento.
2. **Servicio plano enorme**: `server/src/services/` tiene ~1.285 entradas en un
   solo nivel; hay prefijos repetidos (`heartbeat-*`, `idle-*`) que sugieren
   subdirectorios por dominio (`heartbeat/` ya existe con ~91 archivos).
3. **Densidad de docs**: `doc/` mezcla specs, auditorías fechadas, y decenas de
   `idle-*.md`. No hay un índice; este archivo es un primer paso. Un
   `doc/README.md` indexado por tema reduciría el coste de orientarse.
4. **Deuda de diseño en UI**: clases de paleta Tailwind (`bg-red-500`…) siguen
   siendo valores hardcodeados, planificadas como "Run 4" en `DESIGN.md`/
   `doc/design/DECISION-SHEET.md`; renombrado issue→task en copy pendiente.
   Agentes dedicados existentes: `token-auditor`, `codemod-runner`.
5. **Superficie de verificación muy grande** (4.500 tests, muchas suites
   e2e/chaos/benchmarks): el coste está en elegir bien qué correr; `pnpm verify`
   y `--explain` son el camino.
6. **Muy pocos TODO/FIXME** (~9 archivos): la deuda no está marcada en comentarios;
   hay que buscarla por tamaño, acoplamiento y por los `doc/plans/`.
7. **Nombre del directorio vs. producto**: la carpeta local es `clipclip`, el
   producto/paquetes son `paperclip` (`@paperclipai/*`). Tenerlo en cuenta al buscar.

## 7. Cómo proponer mejoras de forma segura

1. Elegir el área y leer solo el doc que corresponde (`AGENTS.md` §2) + reglas cuyos
   globs cubran los archivos.
2. Identificar el módulo dueño antes de escribir código (module-boundaries).
3. Cambio pequeño y acotado → test (rojo/verde si es bug) → `pnpm verify`.
4. Si una regla parece equivocada: **decirlo y proponer el cambio**, no rodearla.
5. PR con la plantilla `.github/PULL_REQUEST_TEMPLATE.md` completa.

## 8. Siguientes pasos sugeridos (por orden de retorno/riesgo)

1. Crear `doc/README.md` índice por tema (bajo riesgo).
2. Medir cobertura/estado de `pnpm verify` en un árbol limpio para tener línea base.
3. Descomponer `routes/issues.ts` por subrecurso (comentarios, documentos,
   checkout, relaciones) conservando rutas y tests — alto valor, requiere plan en
   `doc/plans/YYYY-MM-DD-slug.md`.
4. Agrupar `services/` por dominio con re-exports temporales.
5. Continuar la migración de tokens de UI (Run 4).
