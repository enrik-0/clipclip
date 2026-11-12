# Revisión de punta a punta — organización `test` y producto "Cuentas Claras"

Fecha: 2026-11-12. Base: Paperclip **sin modificar**; todo lo arreglado es configuración, instrucciones o scripts.
Los costes en $ no se consideran (suscripción). Ningún agente tiene límite de turnos, de tiempo ni de presupuesto.

## 1. Veredicto

| Área | Resultado |
|---|---|
| Producto (API) | **Funciona.** Clon limpio de `main`: `npm ci` + `npm run check` → 169/169 pruebas, 0 vulnerabilidades. Prueba de punta a punta propia: 50/50 comprobaciones (H1-H5, errores, bordes, estáticos, seguridad). |
| Producto (UI) | **Sirve y pasa sus pruebas** (jsdom), pero **no se ha probado en un navegador real**. |
| Proceso de agentes | **Funciona de extremo a extremo** (idea → preguntas al board → producto → ADR → repo → historias → TDD → 3 revisiones → aprobación e integración del CTO), con intervención puntual del operador (ver §4). |
| Estabilidad de la plataforma en Windows | **Usable solo con rodeos** (§3). |

## 2. Qué se verificó

### Producto (`D:\proyectos\test-software`, rama `main`, 59 commits, sin remotos)
- **H1 grupos:** crear con moneda (EUR por defecto; USD/GBP/MXN), nombre vacío o de 51 caracteres → 422, abrir por enlace sin login, token inexistente o inválido → 404 uniforme.
- **H2 miembros:** alta y listado; duplicados (exactos, por mayúsculas y por Unicode NFC/NFD) → 409; borrar miembro con gastos (pagador o participante) → 409; sin gastos → 204.
- **H3 gastos:** reparto igual y personalizado; 10,00 entre 3 → 334/333/333 (cuadra al céntimo); importe 0, negativo o no numérico, sin participantes, pagador ajeno, personalizado que no suma (con `difference_cents`) → 422.
- **H4 saldos:** saldos exactos calculados a mano, suman cero, las transferencias dejan a todos a 0 y su número ≤ miembros−1; grupo vacío → `settled`.
- **H5 editar y borrar:** recalcula saldos; 404 en gasto inexistente.
- **UI:** `/` y `/g/:token` se sirven, 3 recursos JS/CSS (0 faltan), sin scripts inline.
- **Seguridad:** CSP y `X-Content-Type-Options`, rate limit frena la enumeración (429), **0 tokens en los logs**.
- Reproducible: `experiments/test-org/e2e/e2e-full.mjs`.

### Organización (Paperclip)
- 13 agentes `idle/ready`, sin límites de turnos/tiempo/presupuesto, contrataciones nuevas con aprobación del board.
- ~150 runs; 23 fallaron (18 por el límite de uso de la suscripción, 5 por `max_turns_exhausted`, ya imposible).
- 74 tareas; **18 documentos publicados como documentos de tarea** (producto, ADR, arquitectura, historias, pruebas, contributing, veredictos, informe de cobertura).
- Interacciones: 1 consulta con 5 preguntas, 1 "pedir cambios", 1 aprobación.

## 3. Rodeos de plataforma (Windows) — sin tocar el código de Paperclip

| Problema | Rodeo |
|---|---|
| Sin `PAPERCLIP_AGENT_JWT_SECRET` los agentes no reciben token de API | `start-dev.ps1` carga `.paperclip/.env` |
| `pnpm dev`: `spawnSync pnpm ENOENT`, scripts con `mkdir -p`/`cp` bajo `cmd.exe`, build del Runner, symlinks `EPERM` | `pnpm dev:server` (+ `dev:ui`) con Git Bash como shell de scripts |
| La sonda de verificación lanza `claude` con entorno vacío y Claude responde en español | `CLAUDE_CONFIG_DIR` + `--append-system-prompt`; la sonda es intermitente (se fuerza con un cambio inocuo de `graceSec`) |
| Memoria (15 GB, con juego y navegador abiertos) | Arrancar con `-NoUi`; Claude Code mató el servidor al quedarse sin memoria |

## 4. Hallazgos, por prioridad

### Alta
1. **La skill `paperclip` no llega a los agentes** (`Unknown skill: paperclip`, comprobado en TES-74). Los agentes **ven tus skills y plugins personales** (unity, legal, productivity…) en lugar de las de la compañía. Consecuencias observadas: **0 de 59 commits llevan el `Co-Authored-By: Paperclip`** que la skill exige, y no saben cambiar estados con un mecanismo documentado (usan la API directamente). **Causa raíz CONFIRMADA (2026-11-12):** Paperclip entrega las skills a Claude creando un **enlace simbólico por skill** (`ensurePaperclipSkillSymlink`, `packages/adapters/claude-local/src/server/prompt-cache.ts`) dentro de un directorio que pasa con `--add-dir`. En este Windows (sin Modo desarrollador y sin administrador) `fs.symlink` de directorios falla con `EPERM`; el error solo se escribe en el log del run (`Failed to materialize Claude skill …: EPERM: operation not permitted, symlink …`) y el directorio `.claude/skills` del bundle queda **vacío**. Reproducido con un script mínimo: symlink tipo `dir` → `EPERM`, tipo `junction` → OK. *No* lo causa el `CLAUDE_CONFIG_DIR` (hipótesis anterior descartada).
   **Arreglos sin tocar código de Paperclip:** (a) activar el **Modo desarrollador** de Windows (Configuración → Sistema → Para programadores) y reiniciar el servidor; o (b) ejecutar el servidor como administrador. **Arreglo de código (más adelante):** usar una *junction* o copiar el directorio cuando falle el symlink (la vía ACP ya copia con `materializePaperclipSkillCopy`).
   **RESUELTO (2026-11-12):** con el Modo desarrollador activado y el servidor reiniciado, una tarea mínima a QA (TES-75) confirma que ve `paperclip`, `complain` y `suggestion-box`, que `paperclip` es invocable (`Launching skill: paperclip`) y que el bundle del run contiene los 3 symlinks. *Pendiente de comprobar:* que los commits nuevos lleven el `Co-Authored-By: Paperclip` y por qué QA recibe 3 de las 7 skills asignadas a otros agentes.
   **Efecto aparte (no investigado):** los agentes cargan además las skills y plugins personales del usuario (herencia del `HOME`/`~/.claude`); ensucia el contexto de cada run.
2. **El backlog no se libera solo.** Tras integrar, el CTO no pasaba las tareas siguientes a `todo`; hizo falta un mensaje del board o moverlas a mano (TES-17..22). Instrucción añadida al CTO; sigue sin dispararse sin un evento.
3. **Una pregunta por comentario no despierta a nadie.** QA pidió decisiones al CTO y al PM en un comentario de su propia tarea (TES-22) y quedó bloqueada; un comentario solo despierta al asignado. **Es el diseño actual de Paperclip, no un fallo** (el usuario tiene features previstas); la org debe usar una tarea o un bloqueo con responsable.
4. **Tarea de aprobación creada sin asignar** (TES-73): nadie la ejecutó hasta que se asignó al CTO.
5. **Tras el límite de uso, las tareas quedan `blocked` sin ningún bloqueo real** y no se retoman solas; hay que devolverlas a `todo`.

### Media
6. **`docs/PRUEBAS.md` está aprobado pero nunca llegó a `main`** (la rama `docs/TES-6-estrategia-pruebas` sigue sin integrar). Tampoco existe `docs/SEGURIDAD.md`.
7. **El README no dice cómo arrancar la app** y `package.json` no tiene script `start` (solo `test`, `lint`, `check`). Se arranca con `node src/server.js` (`PORT`, `DB_PATH`).
8. **Worktrees fuera del proyecto:** 7 carpetas (`wt-*`, `qa-tes65`, `test-software-tes13`) creadas en `D:\proyectos`; el workspace principal quedó con otra rama activa (`feat/TES-21…`), no `main`.
9. **Arranque sin puerta dura:** CTO, DevOps y QA trabajaron antes de aprobar `PRODUCT.md`. Decisión pendiente.
10. **El CEO pidió las historias al CTO**, no al PM, contra la intención del reparto (el resultado fue bueno).
11. **Un comentario del board en una tarea con confirmación pendiente la caduca.**

### Baja / informativa
12. Numeración HU-1..HU-6 (backlog) frente a H1..H5 (`PRODUCT.md`): se aclaró por comentario; conviene unificarla.
13. Aviso de Fastify (`maxParamLength` obsoleto) y de `node:sqlite` experimental; deuda `TES-55` (token recuperable en logs con ciertos separadores) en `backlog`.
14. El PM no hizo preguntas extra al board; anotó "supuestos a confirmar". Se añadió la instrucción de preguntar sin tope; **no se ha podido comprobar su efecto** (no hubo más encargos).
15. Errores de mi propia operación, ya corregidos: arranqué sin el secreto JWT; inventé un tope de 40 $ al responder al CEO (se coló en `PRODUCT.md` y en TES-9; corregido); la primera versión de mi prueba E2E tenía expectativas erróneas y un fallo del cliente en `DELETE`.

## 5. Siguientes pasos recomendados
1. Resolver el hallazgo 1 (skills): es el más importante porque afecta a todos los agentes.
2. Pedir que `docs/PRUEBAS.md` entre en `main`, y añadir al README/`package.json` cómo arrancar.
3. Decidir la puerta de aprobación de `PRODUCT.md` (hallazgo 9).
4. Probar la UI en un navegador real (Playwright o Chrome) y, si falla algo, abrir tareas.
5. Dar un segundo encargo distinto para comprobar la parte de preguntas y la liberación del backlog.
6. Limpiar worktrees de `D:\proyectos` y volver el workspace a `main`.
