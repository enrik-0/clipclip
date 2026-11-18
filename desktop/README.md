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

## Configuración

Las variables del archivo de entorno se pasan al servidor; las del proceso tienen prioridad.

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PAPERCLIP_DESKTOP_REPO_ROOT` | carpeta padre de `desktop/` | Repositorio desde el que se ejecuta el servidor |
| `PAPERCLIP_DESKTOP_ENV_FILE` | `<repo>/.paperclip/.env` | Archivo de entorno del servidor |
| `PAPERCLIP_DESKTOP_URL` | `http://127.0.0.1:<PORT o 3100>` | URL donde buscar un servidor ya en marcha |
| `PAPERCLIP_DESKTOP_SERVER_MODE` | `source` si hay `tsx`, si no `dist` | Ejecutar `server/src` o `server/dist` |
| `PAPERCLIP_DESKTOP_NODE` | `node` | Ejecutable de Node para el servidor |

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
- `src/status-page.mjs`: página local de carga y de error.

## Pruebas

```sh
pnpm test
```

## Limitaciones conocidas

- No hay instalador ni actualización automática: se ejecuta desde el repositorio.
- En Windows, la librería del Postgres embebido lo detiene con `taskkill /f`. De forma intermitente puede quedar un
  proceso `postgres.exe` huérfano que impide el siguiente arranque ("pre-existing shared memory block is still in
  use"). El origen está en esa librería, no en esta app; se resuelve terminando ese proceso.
