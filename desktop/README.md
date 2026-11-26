# Paperclip Desktop (prototipo)

Aplicación de escritorio para Windows que envuelve una instancia local de Paperclip: arranca el servidor, muestra la
UI en una ventana propia y lo mantiene vivo en la bandeja del sistema.

No modifica `server/` ni `ui/`. El paquete queda fuera del workspace de pnpm (tiene su propio `pnpm-lock.yaml`) para no
tocar el lockfile raíz.

## Uso

```sh
cd desktop
pnpm install --ignore-workspace
pnpm start
```

Requisitos: Node en el `PATH` y las dependencias del repositorio instaladas (`pnpm install` en la raíz), igual que para
`pnpm dev:server`. El servidor se ejecuta con ese Node, no con el de Electron.

## Empaquetado (`.exe`)

```sh
pnpm build                  # en la raíz: compila servidor y UI
cd desktop
pnpm install --ignore-workspace
pnpm pack                   # release/win-unpacked/Paperclip Desktop.exe (sin instalador)
pnpm dist                   # instalador NSIS en release/
```

La configuración usa compresión `maximum` (es la que debe llevar el instalador de distribución, y la que aplica la CI
en `.github/workflows/desktop-release.yml`). Es muy lenta; para probar en local, compila sin comprimir:

```sh
ELECTRON_BUILDER_COMPRESSION_LEVEL=0 pnpm dist   # PowerShell: $env:ELECTRON_BUILDER_COMPRESSION_LEVEL=0
```

Los parámetros `-c.compression=...` de la línea de comandos no surten efecto en esta versión de electron-builder.

Para comprobar el instalador de punta a punta (instalación silenciosa, arranque en el puerto 3199 con un home aislado,
comprobación de `/api/health` y de la UI, y desinstalación):

```sh
powershell -File scripts/verify-installer.ps1
```

Windows y el extractor del instalador omiten en silencio los archivos con rutas de más de 260 caracteres, así que
`pnpm stage` empaqueta en un solo archivo el SDK `@microsoft/teams.graph-endpoints` y falla si alguna ruta del servidor
supera los 160 caracteres.

`pnpm stage` (lo ejecutan `pack` y `dist`) deja en `stage/server` el servidor compilado con sus dependencias de
producción y la UI; electron-builder lo copia a `resources/runtime`. La app empaquetada ejecuta el servidor con el propio
Electron como Node (`ELECTRON_RUN_AS_NODE=1`), así que no necesita Node ni el repositorio. Su archivo de entorno vive en
`%APPDATA%\Paperclip Desktop\.env`.

En Windows, `pnpm build` de la raíz necesita Git Bash como shell de scripts
(`npm_config_script_shell`) salvo para `@paperclipai/paperclip-runner`, que se compila con el shell por defecto.

## Comportamiento

- **Servidor propio o externo.** Si ya hay un Paperclip respondiendo en la URL esperada, la app se conecta a él y no lo
  detiene al salir. Si no, lo arranca ella y lo apaga de forma ordenada al salir. Si el servidor encontrado no sirve la
  interfaz (modo solo API, como `pnpm dev:server` sin UI compilada), la ventana lo explica en vez de cargar su página
  de error.
- **Cerrar la ventana no cierra la app.** Se oculta en la bandeja y los agentes siguen trabajando. Para terminar, usa
  "Salir" en el icono de la bandeja o ejecuta `pnpm start -- --quit`. Un proceso lanzado con `--quit` nunca arranca la
  app: si no hay ninguna instancia en marcha, termina enseguida con el código 2.
- **Instancia única.** Lanzarla otra vez trae la ventana existente al frente.
- **Iniciar con Windows.** Opción del menú de la bandeja; arranca oculta (`--hidden`).
- **Enlaces externos** se abren en el navegador del sistema.
- **UI.** Si existe `ui/dist` (o `server/ui-dist`) se sirve esa compilación; si no, se activa el middleware de Vite
  (`PAPERCLIP_UI_DEV_MIDDLEWARE=true`), más lento en el primer arranque.
- **Registro del servidor:** `%APPDATA%\Paperclip Desktop\logs\server.log`.

## Actualizaciones

La app instalada se actualiza sola desde las **GitHub Releases** del repositorio (`electron-updater`). No actúa al
ejecutarse desde un repositorio ni con `PAPERCLIP_DESKTOP_AUTO_UPDATE=0`.

- Busca una versión nueva 30 segundos después de arrancar y cada 6 horas, y la descarga en segundo plano.
- Cuando está lista, el menú de la bandeja ofrece **"Reiniciar para actualizar a X"** (para el servidor de forma
  ordenada, instala en silencio y vuelve a abrir la app). Si no se elige, se instala al elegir "Salir".
- La versión nueva solo se instala si es **mayor** que la instalada.

**Publicar una versión.** Sube una etiqueta `desktop-vX.Y.Z`. El workflow `desktop-release.yml` construye el instalador con
esa versión y crea la release con tres archivos: `Paperclip-Desktop-Setup-X.Y.Z.exe`, su `.blockmap` y `latest.yml`. El
`latest.yml` es lo que lee el actualizador, y su `url` debe coincidir con el nombre del instalador, por eso `artifactName`
no lleva espacios (GitHub los cambia por puntos). El propietario y el repositorio salen de `github.repository`.

**Probarlo sin publicar.** Sirve una carpeta con `latest.yml` y el instalador por HTTP y arranca la app con
`PAPERCLIP_DESKTOP_UPDATE_URL=http://127.0.0.1:8766`.

Limitaciones: el repositorio no debe tener otras releases que no sean de la app de escritorio (el actualizador toma la
última release publicada), y sin firma de código no se verifica el editor del instalador, solo su hash `sha512`.

## Configuración

Las variables del archivo de entorno se pasan al servidor; las del proceso tienen prioridad.

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PAPERCLIP_DESKTOP_REPO_ROOT` | carpeta padre de `desktop/` | Repositorio desde el que se ejecuta el servidor |
| `PAPERCLIP_DESKTOP_ENV_FILE` | `<repo>/.paperclip/.env` | Archivo de entorno del servidor |
| `PAPERCLIP_DESKTOP_URL` | `http://127.0.0.1:<PORT o 3100>` | URL donde buscar un servidor ya en marcha |
| `PAPERCLIP_DESKTOP_SERVER_MODE` | `source` si hay `tsx`, si no `dist` | Ejecutar `server/src` o `server/dist` |
| `PAPERCLIP_DESKTOP_NODE` | `node` | Ejecutable de Node para el servidor |
| `PAPERCLIP_DESKTOP_AUTO_UPDATE` | activa en la app instalada | `0` desactiva la autoactualización |
| `PAPERCLIP_DESKTOP_UPDATE_URL` | las releases de GitHub | Origen alternativo de actualizaciones (un `latest.yml` servido por HTTP) |

"Iniciar con Windows" no conserva variables definidas solo en la terminal: usa los valores por defecto o defínelas como
variables de entorno del usuario.

## Estructura

- `src/main.mjs`: proceso principal de Electron (ventana, bandeja, ciclo de vida).
- `src/server-supervisor.mjs`: arranca, detecta y detiene el servidor.
- `src/server-host.mjs`: proceso Node que aloja el servidor y recibe la orden de apagado por IPC, porque Windows no
  puede enviar `SIGTERM` a un proceso hijo.
- `src/launch.mjs`: decide qué hace un proceso recién lanzado (arrancar, ceder a la instancia en marcha o salir con
  `--quit`).
- `src/config.mjs`: resolución de rutas y entorno.
- `src/updater.mjs`: autoactualización (estado y comprobaciones; el actualizador se inyecta para poder probarlo).
- `src/status-page.mjs`: página local de carga y de error.

## Pruebas

```sh
pnpm test
```

## Limitaciones conocidas

- No hay firma de código (SmartScreen avisará al instalar).
<!-- Rama temporal: este cambio solo dispara la compilación del instalador para el e2e del issue 32. -->

- En Windows, la librería del Postgres embebido lo detiene con `taskkill /f`. De forma intermitente puede quedar un
  proceso `postgres.exe` huérfano que impide el siguiente arranque ("pre-existing shared memory block is still in
  use"). El origen está en esa librería, no en esta app; se resuelve terminando ese proceso.
