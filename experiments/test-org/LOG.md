# Registro de la prueba de la organización `test`

Base de trabajo: **Paperclip sin modificar** (rama `master` + `experiments/`). Todo lo que se arregla es
configuración, instrucciones o scripts. Los gastos en $ no se consideran (suscripción); los topes de
presupuesto están a 0 (= sin tope).

## Problemas encontrados y cómo se resolvieron

| # | Problema | Causa | Solución | Estado |
|---|---|---|---|---|
| 1 | Los agentes no podían hablar con Paperclip (`Empty bearer token`) | El servidor se arrancó a mano **sin `PAPERCLIP_AGENT_JWT_SECRET`**, así que no podía firmar el token de cada run | `start-dev.ps1` carga `.paperclip/.env` con los secretos | Resuelto |
| 2 | Los agentes quedaban en `paused/verifying` | La sonda de Paperclip lanza `claude` con un entorno vacío (sin `HOME`/`USERPROFILE`) y Claude respondía en español ("¡Hola!") en vez de `hello` | En el `adapterConfig`: `env.CLAUDE_CONFIG_DIR` + `--append-system-prompt "responde exactamente con la palabra pedida"`. La sonda es **intermitente**: un cambio inocuo (`graceSec`) fuerza otra | Resuelto (con reintentos) |
| 3 | `pnpm dev` falla en Windows | `agent-preflight` (`spawnSync pnpm ENOENT`), scripts de pnpm con `mkdir -p`/`cp` bajo `cmd.exe`, build del Runner nativo, symlinks (`EPERM`) | Se usa `pnpm dev:server` + `pnpm dev:ui` con `npm_config_script_shell` = Git Bash | Rodeado (no se toca Paperclip) |
| 4 | El board no podía leer `PRODUCT.md`/ADR | Los agentes los escribían solo como archivos en el workspace | Instrucciones: todo documento para el board se **publica como documento de la tarea** (`PUT /issues/{id}/documents/{key}`) y se mantiene igual que el del repo. Los ya existentes se espejaron a mano | Resuelto en instrucciones; **vigilar** que lo cumplan |
| 5 | Restricciones inventadas por el operador (tope de 40 $, "pocas tareas") se propagaron a `PRODUCT.md`, ADR y TES-9 | Mi respuesta al CEO incluyó ese tope | Corregido por comentario del board y revisión de `PRODUCT.md` (v2) | Resuelto |
| 6 | Un comentario en una tarea con una confirmación pendiente **la caduca** (`expired`) | Comportamiento de Paperclip | Dejar la decisión explícita en un comentario o responder primero a la confirmación | Anotado |
| 7 | El arranque no esperó a la aprobación de `PRODUCT.md` | La regla del CEO solo bloqueaba las funcionalidades; CTO/DevOps/QA corrieron en paralelo | Pendiente de decidir si se quiere una puerta dura | Abierto |
| 8 | El CEO pidió las historias al CTO en vez de al PM | Ambigüedad en las instrucciones ("pide al PM las historias") | Observado; el resultado fue bueno. Aclarar el reparto PM/CTO si molesta | Abierto |
| 9 | El PM no hizo preguntas adicionales al board | No hay regla de repreguntar; anotó "supuestos a confirmar" | Instrucciones nuevas: preguntar sin tope, sin ser regla dura. **Por probar** | En prueba |

## Acciones hechas como board por el operador (para revisar)
Ver `D:\proyectos\test-org-data\board-actions.md`.

## Cronología (UTC)
- 19:01 — primer run del CEO (fallo: sin API).
- 19:05 — tras arrancar con el secreto JWT, el CEO abre una consulta formal con 5 preguntas.
- 19:06 — respuestas del board; el CEO crea las 4 tareas de arranque; PM, CTO y DevOps trabajan en paralelo.
- 19:16 — "Pedir cambios" a `PRODUCT.md`; el PM publica v2 y se aprueba.
- 19:22 — arranque cerrado; el CEO abre la Iniciativa 1 (historias).
- 19:3x — backlog aprobado; el CTO descompone en TES-10..TES-22 y Backend empieza.

## Hallazgos de la sesión autónoma (hasta 19:58 UTC)
- 10. Hueco de instrucciones: nadie creaba la tarea de aprobación del CTO. Corregido (el autor la crea; una tarea de código no termina hasta integrarse en `main`). Tras el cambio el CTO integró en `main` (28 commits).
- 11. Las revisiones encuentran defectos reales (nombres duplicados por Unicode, token en claro en logs) y el autor los corrige con TDD.
- 12. Backend trabaja de uno en uno con muchas ejecuciones encoladas: es el cuello de botella.
- 13. **Estado final: pipeline parado.** Ningún run en curso; tareas 10, 11, 13, 14, 47, 50 en `blocked` (esperan que Backend las cierre tras la integración); Frontend (17-22) sin empezar en `backlog`.
- Siguiente paso sugerido: despertar a Backend sobre las tareas bloqueadas y comprobar que quien libera el `backlog` de Frontend es el CTO/CEO.

## Reanudación (2026-11-12 16:30 Madrid)
- 14. **Límite de uso de la suscripción**: los runs fallan en segundos con `claude_transient_upstream` ("5-hour limit") y el sistema deja las tareas en `blocked` **sin ningún bloqueo real**. Solución: devolverlas a `todo` (de una en una). Tras restablecerse el límite el flujo se retomó solo.
- 15. **Memoria del PC (15 GB)**: con el juego y Opera abiertos solo quedaba 1 GB libre y Claude Code mató el servidor y la UI. Arrancar sin UI (`start-dev.ps1 -NoUi`) basta.
- 16. **El CTO no liberaba el backlog** (frontend) al terminar el backend; hizo falta un aviso del board. Instrucción añadida al CTO ("Mantener el flujo").
- 17. **QA con `maxTurnsPerRun: 30` se queda corto** para tareas grandes (suite de aceptación: `max_turns_exhausted`; el reintento tardó ~9 min). Pendiente: subir los turnos de todos los agentes (60-80). No se ha aplicado porque cambiar el `adapterConfig` relanza la sonda de verificación, que es intermitente.
- Backend completo (TES-10..16) revisado por Revisor, QA y Seguridad e integrado en `main` por el CTO (45 commits). Frontend en curso.
