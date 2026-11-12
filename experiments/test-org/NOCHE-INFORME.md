# Informe de la noche (12-13/11/2026)

Plan programado para las 23:00; empezó a las 23:49 porque la sesión estaba ocupada. Sin atribución a ninguna IA en
este proyecto (orden del usuario). Informe actualizado fase por fase.

## Estado de partida
- Servidor de Paperclip **caído**: el sistema lo cerró por falta de memoria (aviso del entorno: no relanzarlo por
  cuenta propia). Postgres sano. RAM libre: 3,4 GB.
- Decisión: hacer las fases que no necesitan el servidor (B, C, D) y **dejar la E (filial de vídeo) para cuando el usuario
  pida arrancar el servidor**.

## Fase B — Baseline congelado ✔
- Etiquetas anotadas **subidas al fork**: `baseline-paperclip-2026-11-12` (commit `6dd8611a2f`, Paperclip sin modificar) y
  `baseline-lab-2026-11-12` (rama del laboratorio).
- Copia de Postgres: `D:\proyectos\test-org-data\backups\baseline-2026-11-12.sql` (31 MB, 39.361 líneas, 322 tablas).
- `D:\proyectos\test-software`: etiqueta `baseline-v1` sobre `main`.

## Fase C — Revisión de la UI de Cuentas Claras en Chrome real ✔
`claude-in-chrome` **funciona** (se probó a petición del usuario). App exportada de `main` a una carpeta temporal
(`npm ci`, puerto 3199); la app y la carpeta se eliminaron al terminar.

**Funciona (sin fallos funcionales, consola limpia: 0 mensajes):**
crear grupo con enlace copiable/abrible; añadir miembros; duplicado ("ana" frente a "Ana") con mensaje en rojo; gasto a partes
iguales (60,00 €, coma decimal); gasto por importes con validación en vivo ("las partes no suman… faltan 12,00 €");
saldos y "quién paga a quién" **correctos tras cada operación** (Ana +34/Luis −14/Marta −20; tras editar +54/−24/−30; tras
borrar +60/−30/−30); editar ("Editando «Compra»", Guardar/Cancelar); borrar con `<dialog>` de confirmación ("no se puede
deshacer"); el mismo enlace en otra pestaña muestra el estado guardado; enlaces inválidos → "Grupo no encontrado" con salida;
validación por campo en el formulario de gasto; la página **no se puede incrustar en un iframe** (bien, seguridad).

**Detalles de UX (menores, sin tareas creadas porque el servidor de Paperclip estaba parado):**
1. "Ana" (el primer miembro) aparece **marcada por defecto** como participante; los demás no.
2. El **mensaje de error de duplicado persiste** tras otras acciones y el campo conserva el texto rechazado ("ana").
3. El estado de éxito ("Gasto «Compra» guardado.") sigue visible al empezar otro gasto.
4. Al **editar un gasto a partes iguales**, el formulario se abre en modo "Importes por persona".
5. "Entre: Ana, Luis, Marta" lista a un participante con parte 0 (Taxi: Marta 0,00).
6. Casillas y botones de radio de 24 px (menos de 44 px táctiles).
7. **No se pudo probar un viewport móvil real**: la ventana de Chrome no se deja redimensionar. Aproximación estrechando la
   página a 390 px: sin desbordes y controles ≥44 px de alto. Pendiente: prueba en un móvil real.

## Fase D — Desarrollo en Paperclip (ramas en el fork; nada en `master`, sin PRs)
Worktree `D:\proyectos\clipclip\.claude\worktrees\dev-night` desde la etiqueta `baseline-paperclip-2026-11-12`
(rama local `dev/night-base`, sin cambios).

### D1 — Herramienta de desarrollo en Windows (con Modo desarrollador)
| Comprobación | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | **OK** (31 s), **0 errores `EPERM`**; el `postinstall` de symlinks (`link-plugin-dev-sdk`) ya funciona ("Linked @paperclipai/plugin-sdk into 10 excluded plugin(s)"). Avisos benignos "Failed to create bin" de paquetes sin compilar. |
| typecheck `@paperclipai/adapter-utils` y `adapter-claude-local` | **OK** |
| Vitest `adapter-utils/src/server-utils.test.ts` (baseline) | 135 pasan, 6 omitidos |
| `pnpm verify --explain` | **Código 2 tras 329 s** (= "necesita verificación más amplia" según AGENTS.md; se toca un paquete compartido). No se lanzó la suite completa. |
| Vitest `claude-local/src/server/test.probe.test.ts` | **18 de 23 fallan en el baseline** en Windows: el montaje del sandbox falso acaba en `claude_managed_config_dir_failed` (los tests suponen un host POSIX). |
| Vitest `claude-local/src/server/probe-env.test.ts` | **1 de 6 falla en el baseline**: "resolves claude from the trusted PATH" crea un ejecutable `claude` sin extensión y Windows exige `PATHEXT`. |
| Efecto lateral de los tests | Escriben en el HOME real: crearon `C:\Users\villa\.paperclip\instances\default\companies\company-1\…\settings.json` (1 archivo). **No se pudo borrar** (el sistema denegó el borrado y el plan prohibía borrar datos): eliminarlo a mano si se quiere. |

### D2 — `fix/skill-symlink-fallback` (commit `d9ad22089e`, subida al fork)
- `linkPaperclipSkillWithFallback` (en `adapter-utils/src/server-utils.ts`): symlink → **junction en Windows** → **copia**
  (`materializePaperclipSkillCopy`) cuando falla con `EPERM/EACCES/ENOTSUP/EOPNOTSUPP`; cualquier otro error se relanza.
  `ensurePaperclipSkillSymlink` la usa por defecto, así que arregla también pi-local, hermes y ACP.
- El prompt bundle de claude-local registra en el log del run `Skill "…" could not be symlinked (EPERM); made available as a
  junction/copy instead.` → el fallo ya **no es silencioso**.
- TDD rojo → verde: 6 tests nuevos (141 pasan en `server-utils.test.ts`), typecheck de los dos paquetes en verde.
- Límite conocido: una copia (a diferencia del symlink) no sigue cambios de la skill en destinos persistentes (pi-local,
  hermes); el bundle de claude-local es direccionado por contenido, así que no le afecta. No se probó el `EPERM` real
  (ahora el symlink funciona en este equipo).

### D3 — `fix/agent-probe-language-neutral` (commit `550f5dabd2`, subida al fork)
**Corrección de mi diagnóstico anterior:** se pensaba que la sonda fallaba porque `claude` se lanzaba con un entorno vacío
y no encontraba el login en Windows. **Es falso**: con `env -i` y sin `CLAUDE_CONFIG_DIR`, Claude se autentica (probado).
La causa real es que la sonda exige `/\bhello\b/i` y un Claude configurado en español responde "¡Hola!". Por eso la rama
no toca el entorno (nombre inicial `fix/agent-probe-windows` descartado).
- Nuevo `probe-prompt.ts`: ambos carriles (CLI en `test.ts`, ACP en `acp.ts`) piden "una sola palabra, en inglés: hello"
  (verificado con tu Claude real: responde exactamente `hello`), y el hint fijo de `unexpected_output` explica que un
  idioma configurado puede causarlo. La sonda sigue exigiendo `hello` y no repite salida no confiable.
- **No** se añadió `detail` con diagnóstico: un test existente exige que ese check no lleve `detail` (decisión de diseño).
- TDD rojo → verde: 3 tests nuevos en `probe-prompt.test.ts`; typecheck en verde. Los tests de integración de la sonda no
  se pudieron usar para validar (fallan en Windows en el baseline, ver D1).
- Pendiente (otros adaptadores con el mismo patrón "Respond with hello."): opencode-local, pi-local, gemini-local,
  kimi-local, cursor-local.
- Sigue sin explicar la **intermitencia** de la sonda (a veces pasaba y a veces no con la misma configuración).

## Fase E — Filial de vídeo: NO ejecutada
El servidor de Paperclip estaba parado (cerrado por el sistema por falta de memoria) y el aviso del entorno indica no
relanzarlo por cuenta propia. Pendiente para cuando el usuario lo pida. Dato útil: `ffmpeg` está instalado
(`…\Gyan.FFmpeg…\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe`, en el PATH del usuario).

## Estado final
- Servidor de Paperclip: **parado**. Postgres (Docker): arriba y sano. 13 agentes en reposo (sin runs en curso).
- Chrome: pestañas cerradas. App temporal de Cuentas Claras: parada y carpeta borrada.
- Worktree `dev-night` conservado (ramas `dev/night-base` local, `fix/skill-symlink-fallback`, `fix/agent-probe-language-neutral`).
- Sin ninguna atribución a una IA en los commits de esta noche.

## Recomendaciones
1. Revisar las dos ramas del fork (`fix/skill-symlink-fallback`, `fix/agent-probe-language-neutral`); abrir PR al upstream solo si se quiere.
2. Hacer pasar en Windows la suite de la sonda de claude-local (tests que suponen POSIX) antes de seguir modificando esa zona.
3. Arrancar el servidor (sin UI) y ejecutar la fase E (vídeo); crear en Paperclip las tareas de UX de la fase C.
4. Investigar la intermitencia de la sonda con el prompt nuevo (¿desaparece?).
