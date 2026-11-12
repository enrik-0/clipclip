# Cambios pendientes en el interior de Paperclip

Lista de modificaciones **de código de Paperclip** que salieron de la prueba de la organización `test`.
Contexto: primero se quería una base **estable y sin modificar** (rodeada con configuración, instrucciones y
scripts); estos cambios se harán **después**. Las referencias a archivos son de la versión probada
(`master`, commit `6dd8611a2f`).

## 1. Skills en Windows: fallback cuando falla el symlink  ← anotado a petición del usuario
- **Problema:** `ensurePaperclipSkillSymlink` (`packages/adapters/claude-local/src/server/prompt-cache.ts`) crea
  un symlink por skill en el directorio que se pasa a Claude con `--add-dir`. En Windows sin Modo desarrollador
  ni administrador da `EPERM`; el error solo va al log del run y el agente arranca **sin las skills de la
  compañía** (sin `paperclip`, `complain`, `paperclip-board`…), sin que nadie lo vea.
- **Cambio propuesto:** al fallar el symlink, usar una **junction** (`fs.symlinkSync(src, dst, "junction")`
  funciona sin privilegios) o **copiar** la carpeta. La vía ACP ya copia (`materializePaperclipSkillCopy`).
  Además, que el fallo sea **visible**: aviso en la UI/estado del run o check en la verificación del agente.
- **Estado del entorno:** el usuario ya activó el Modo desarrollador (2026-11-12), con lo que el symlink funciona
  aquí y se **verificó** (TES-75: el agente ve e invoca `paperclip`); el cambio sigue siendo necesario para otros
  equipos Windows.

## 2. Sonda de verificación de agentes (`claude-local/src/server/test.ts`, `probe-env.ts`)
- Lanza `claude` con un **entorno casi vacío** (sin `HOME`/`USERPROFILE`/`PATH`): en Windows no encuentra el login.
- Exige que la respuesta contenga la palabra `hello`: **falla si Claude responde en español** (configuración del usuario).
- Es **intermitente** y **oculta su salida** (solo `unexpected_output`): añadir un modo de diagnóstico.
- **Cualquier cambio del `adapterConfig`** (incluso `graceSec`) relanza la verificación; desde `verifying`,
  `pause` + `resume` vuelve a `verifying` (no hay forma legítima de continuar sin pasar la sonda).
- Rodeo actual: `CLAUDE_CONFIG_DIR` + `--append-system-prompt` en el `adapterConfig`.

## 3. Arranque de desarrollo en Windows
- `scripts/agent-preflight.mjs`: `spawnSync pnpm ENOENT` (no resuelve `pnpm.cmd`).
- Scripts de pnpm con `mkdir -p`/`cp` fallan bajo `cmd.exe` (p. ej. `packages/shared` `build`).
- `dev-runner` compila el Runner nativo y falla (`check:acpx-profiles`: "grok commandDigest no longer matches…").
- Rodeo: `pnpm dev:server` + `dev:ui` con `npm_config_script_shell` = Git Bash (`experiments/test-org/start-dev.ps1`).

## 4. API y flujo de trabajo
- `PATCH /api/agents/:id` **fusiona** `adapterConfig`: no permite borrar claves (hay que poner un valor neutro,
  p. ej. `maxTurnsPerRun: 0`).
- Un **comentario** en una tarea solo despierta al asignado: preguntar a otro agente por comentario no funciona.
  Un comentario del board sobre una tarea con una confirmación pendiente la **caduca**.
- Tareas creadas **sin asignado** (p. ej. la aprobación del CTO) no se ejecutan y nada avisa.
- Tras un fallo por límite de uso (`claude_transient_upstream`) las tareas quedan en `blocked` **sin ningún
  bloqueo real** y no se retoman solas al restablecerse el límite.
- El **backlog no se libera** al cumplirse sus dependencias: depende de que un agente lo haga.
- Un despertar sin tarea concreta no hace nada (la bandeja solo contiene tareas propias).

## 5. Configuración personal del usuario filtrada a los agentes
- Los runs de `claude_local` heredan `~/.claude` del usuario: cargan **sus skills y plugins personales**
  (unity, legal, productivity…) y sus MCP; ensucia el contexto y puede alterar el comportamiento. Aislar el
  directorio de configuración sin copiar credenciales.

## 6. Presupuestos con suscripción
- Los topes en $ no tienen sentido con suscripción (se dejaron a 0 = sin tope). Valorar un modo "suscripción".

## 7. Aislamiento de workspaces
- Sin política de workspace aislado, los agentes crearon **worktrees fuera del proyecto** (`D:\proyectos\wt-*`) y
  el workspace principal acabó en otra rama. Definir `worktreeParentDir` y `isolated_workspace` en el proyecto.
