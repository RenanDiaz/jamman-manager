# ADR 0001: Protocolo propio `jamman://` para reproducir audio

- **Estado:** Aceptado
- **Fecha:** 2026-11-07
- **Relacionado:** `docs/specs/project-review-remediation.md` (1.1, 1.2, 1.4 y 5.3)

## Contexto

La app reproduce los `phrase.wav` de la tarjeta SD del JamMan en un elemento `<audio>` del renderer, y el usuario necesita poder adelantar y retroceder (seek) en loops largos.

El renderer no puede usar URLs `file://` directamente:

- en desarrollo la página se sirve desde `http://localhost`, y Chromium bloquea `file://` desde un origen `http:`;
- en producción la página es `file://`, pero permitir `file://` en `media-src` abriría todo el disco a cualquier contenido que llegue a ejecutarse en el renderer;
- con `sandbox: true` y `contextIsolation`, el renderer no tiene acceso a Node para leer archivos.

Se descartó también leer el WAV entero por IPC (`audio:readFile`) y reproducirlo como `Blob`: carga el archivo completo en memoria y en el renderer antes de poder sonar, y no aprovecha el streaming de Chromium.

## Decisión

Se mantiene un esquema propio, `jamman://`, servido por el proceso main con `protocol.handle`. El renderer pide la URL con `phrase:getAudioURL` y la pone en el `<audio>`. El handler vive en `packages/main/src/security/jammanProtocol.ts` como función pura (recibe la raíz permitida y las funciones de fs) y `index.ts` solo lo registra.

### Qué puede servir el handler

Solo archivos `.wav` dentro de la carpeta del SD aprobada. Por cada petición:

1. Solo `GET` y `HEAD` (si no, 405).
2. Se decodifica la ruta. Vacía o mal codificada: 400.
3. Debe ser absoluta, terminar en `.wav` y quedar dentro de la raíz después de `path.resolve` (esto neutraliza `..`). Si no: 403.
4. Se resuelven los symlinks con `fs.realpath` (de la raíz y del archivo) y se repiten las dos comprobaciones sobre la ruta real. Un symlink dentro de la carpeta que apunta fuera, o un `.wav` que apunta a un archivo de otro tipo, da 403.
5. Debe ser un archivo regular (si no, 403). Si no existe, 404.
6. Responde `200` con el archivo entero o `206 Partial Content` con `Content-Range` si llega un `Range: bytes=…`. Un rango fuera del archivo da 416.

El handler sirve los rangos él mismo, con `fs.createReadStream`, en vez de pasar la petición a `net.fetch(pathToFileURL(…))`. Se comprobó en Electron 39 que `net.fetch` de una URL `file:` respeta la cabecera `Range` pero contesta `200` sin `Content-Range`, y con esa respuesta el elemento `<audio>` no puede hacer seek de forma fiable. Como el handler ya no construye ninguna URL `file://`, tampoco hace falta `pathToFileURL`.

### De dónde sale la raíz permitida

La raíz no la decide el renderer. La política está en `packages/main/src/security/folderAccess.ts`:

- La única forma de aprobar una carpeta es el diálogo nativo `dialog:selectFolder`, que abre el main y contesta el usuario. La ruta que devuelve el diálogo pasa a ser la única raíz aprobada.
- La raíz aprobada se guarda en `userData/folder-access.json`. Así, al reiniciar, el renderer puede seguir cargando automáticamente la última carpeta (que guarda en `localStorage`): el main la acepta solo si coincide con la que el usuario aprobó en el diálogo. Una ruta distinta que mande el renderer se rechaza, aunque sea una carpeta real.
- Los archivos que el usuario elige en `dialog:selectFile` (WAVs para importar) y en `backup:selectFile` (ZIPs de backup) quedan permitidos individualmente, solo en memoria y solo durante la sesión.

La misma política se aplica a los handlers IPC que reciben rutas:

- los que reciben `basePath`/`folderPath`/`targetPath` (`patches:*`, `playlists:*`, `folder:getSize`, `backup:create`, `backup:restore`) exigen que sea exactamente la raíz aprobada;
- `audio:validateWav`, `audio:readFile` y los WAV de origen de `patches:create`/`patches:update` exigen un `.wav` dentro de la raíz o elegido en el diálogo;
- `backup:validate` y `backup:restore` exigen un `.zip` elegido en el diálogo o dentro de la raíz;
- `patches:update`, `patches:deleteBatch` y `patches:reorder` validan además que los nombres de carpeta sean `PatchNN`, porque se unían a la ruta sin validar.

Los handlers de exportación (`patches:exportTXT|PDF`) solo usan `basePath` como ruta por defecto del diálogo de guardar, así que no se restringen.

### Otras restricciones que rodean al protocolo

- **Sin `bypassCSP`.** El esquema se registra con `supportFetchAPI` y `stream` solamente. La CSP (`packages/main/src/security/contentSecurityPolicy.ts`, enviada por cabecera desde el main en desarrollo y en producción) permite el audio con `media-src 'self' jamman:`. Se comprobó que con esa CSP el `<audio>` carga `jamman://` sin `bypassCSP`.
- **Solo la página de la app puede pedir URLs.** `phrase:getAudioURL` y el resto de handlers IPC pasan por `assertTrustedSender` (`packages/main/src/security/trustedSender.ts`): la llamada tiene que venir del frame principal con el origen del dev server (desarrollo) o del `index.html` empaquetado (producción).
- **El renderer no navega ni abre ventanas.** La navegación y `window.open` se deniegan por defecto, así que no puede cargarse en la ventana una página ajena que use el protocolo.

## Consecuencias

- Aunque se inyecte código en el renderer, `jamman://` no sirve nada fuera de la carpeta del SD aprobada ni nada que no sea `.wav`.
- La primera vez tras actualizar a esta versión, la carpeta que el renderer recuerda en `localStorage` todavía no está en `folder-access.json`, así que la carga automática falla y el usuario tiene que elegir la carpeta una vez con el diálogo. A partir de ahí la carga automática vuelve a funcionar.
- Elegir otra carpeta reemplaza la raíz: la anterior deja de ser accesible.
- Si la tarjeta SD se monta en otra ruta (por ejemplo `/Volumes/JAMMAN 1`), hay que volver a elegirla.
- Queda una ventana TOCTOU entre `realpath` y la apertura del archivo: alguien que pueda escribir en el SD podría cambiar un archivo por un symlink en ese intervalo. Se acepta, porque requiere escribir en la tarjeta, y quien puede hacerlo ya tiene acceso a esos archivos.
- Los cambios en el handler deben mantener los tests de `packages/main/src/security/jammanProtocol.test.ts` (ruta válida, rangos, `..`, extensión, symlinks, ruta vacía, sin raíz).
