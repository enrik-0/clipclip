# Cambios pendientes en la organización `test`

Cambios de **configuración, instrucciones, proceso o producto** (no tocan el código de Paperclip).
Los cambios de código están en `PENDIENTES-PAPERCLIP.md`. La numeración (#) remite a `E2E-REVIEW.md`.

## Instrucciones y proceso de los agentes
- **Liberar el backlog** (#7): el CTO (o el autor) debe crear/pasar a `todo` las tareas siguientes cuando sus
  dependencias estén integradas. Ya se añadió una frase al CTO ("Mantener el flujo"); no bastó sin un evento.
- **Preguntas entre agentes** (#8): con una tarea asignada o un bloqueo con responsable, no por comentario (el
  comentario no despierta a otros agentes: es el diseño actual de Paperclip).
- **Asignar siempre** las tareas que se crean (#9), p. ej. la aprobación del CTO (TES-73 salió sin asignado).
- **Puerta de aprobación de `PRODUCT.md`** (#13): decidir si CTO, DevOps y QA esperan a que el board la apruebe.
- **Documentos aprobados deben llegar a `main`** (#14): `docs/PRUEBAS.md` sigue solo en la rama `docs/TES-6…`; Seguridad
  debe escribir `docs/SEGURIDAD.md` cuando haya arquitectura.
- **Reparto de historias** (#17): aclarar que las escribe el PM, no el CTO.
- **Preguntas del PM** (#18): comprobar con un segundo encargo si, tras la instrucción de preguntar sin tope, pregunta más.

## Producto "Cuentas Claras"
- **README y script `start`** (#15): documentar cómo arrancar (`node src/server.js`, `PORT`, `DB_PATH`).
- Unificar la numeración HU-1..HU-6 (backlog) con H1..H5 (`PRODUCT.md`).
- Deuda `TES-55` (token recuperable en logs con ciertos separadores).
- Probar la **UI en un navegador real**.

## Configuración del proyecto y de los agentes
- **Worktrees** (#16): definir `worktreeParentDir` y el espacio de trabajo aislado en el proyecto `Software`; instruir a
  DevOps; limpiar las 7 carpetas `D:\proyectos\wt-*`/`qa-tes65`/`test-software-tes13` y devolver el workspace a `main`.
- **Cuello de botella de Backend**: `maxConcurrentRuns: 1` con muchas ejecuciones encoladas; valorar subirlo.
- **Investigar por qué QA recibe 3 de las 7 skills** asignadas.
- **Rodeos actuales a retirar** cuando se arregle Paperclip: `CLAUDE_CONFIG_DIR` + `--append-system-prompt` + bump de
  `graceSec` (sonda), `start-dev.ps1` (arranque en Windows), `maxTurnsPerRun: 0` (el `PATCH` fusiona).

## Procedimiento operativo mientras tanto
- Tras un fallo por límite de uso, devolver a `todo` las tareas que queden `blocked` sin bloqueo real (de una en una).
- Los commits nuevos llevarán el `Co-Authored-By: Paperclip` hasta cambiar la skill (ver PENDIENTES-PAPERCLIP 1b).

## Tareas de UX por crear en Paperclip (revisión en Chrome de la noche del 12-13/11; el servidor estaba parado)
Proyecto `Software`, como lo haría un usuario (una por punto, con la idea, sin explicar el flujo):
1. El primer miembro aparece marcado por defecto como participante del gasto.
2. El mensaje de error de duplicado de miembro persiste y el campo conserva el texto rechazado.
3. El mensaje de éxito del gasto anterior sigue visible al empezar otro gasto.
4. Al editar un gasto a partes iguales el formulario se abre en modo "Importes por persona".
5. "Entre: …" lista a un participante con parte 0 en un reparto por importes.
6. Casillas y radios de 24 px (menos de 44 px táctiles).
7. Probar en un móvil real (la ventana de Chrome no se pudo redimensionar).

## Fase pendiente
- **Filial de vídeo** (no ejecutada): arrancar el servidor sin UI y dar al CEO solo la idea; `ffmpeg` ya está instalado. No
  aprobar ninguna publicación real (no hay canal).
- Residuo de tests en tu carpeta personal: `C:\Users\villa\.paperclip\` (1 archivo, creado por los tests de claude-local);
  se puede borrar a mano.
