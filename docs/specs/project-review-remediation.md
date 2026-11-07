# Spec: Remediación tras la revisión del proyecto (2026-11-07)

**Estado:** Pendiente de implementar
**Rama base sugerida:** `improvements`
**Origen:** Revisión del proyecto sobre el boilerplate `vite-electron-builder`. Typecheck y los 127 tests pasaban; lint daba 0 errores y 29 warnings. No se ejecutaron e2e ni se compiló el instalador.

## 1. Objetivo

Cerrar los problemas de seguridad, dependencias, CI, pruebas y deuda técnica encontrados en la revisión, sin cambiar el comportamiento visible de la app para el usuario.

### Fuera de alcance

- Migrar a Electron Forge o electron-vite. Se evaluó y no se justifica.
- Funcionalidades nuevas (waveform, edición de audio, normalización, importación WAV por lotes).
- Cambios de diseño de UI.

## 2. Resumen de fases

| Fase | Tema                            | Prioridad |
| ---- | ------------------------------- | --------- |
| 1    | Seguridad de Electron           | Crítica   |
| 2    | CI que realmente bloquee        | Alta      |
| 3    | Dependencias y runtime          | Alta      |
| 4    | Refactor de `index.ts` + tests  | Media     |
| 5    | Deuda funcional (undo, versión) | Media     |
| 6    | Limpieza del boilerplate        | Baja      |
| 7    | Firma y distribución            | Media     |

Orden recomendado: 1 → 2 → 3 → 4 → 5 → 6 → 7. Las fases 1 y 2 son independientes entre sí y se pueden hacer en paralelo. La fase 4 depende de que la CI (fase 2) ya bloquee, para que el refactor quede protegido por tests.

---

## Fase 1: Seguridad de Electron

### 1.1 Restringir el protocolo `jamman://`

**Problema.** `packages/main/src/index.ts:135-170` toma la ruta de la URL, solo comprueba que el archivo exista y responde con `net.fetch(file://…)`. El esquema se registró con `bypassCSP: true` (`index.ts:79-88`). No se valida contra `PathValidator` ni contra la carpeta elegida, así que cualquier contenido del renderer puede leer cualquier archivo del disco.

**Cambios.**

- Guardar en el main la carpeta del SD que el usuario eligió (la que devuelve `dialog:selectFolder`), como única raíz permitida.
- En el handler de `jamman://`:
  - decodificar la ruta y resolverla con `path.resolve`;
  - exigir extensión `.wav` (`PathValidator.hasAllowedExtension`);
  - exigir que quede dentro de la raíz permitida (`PathValidator.isPathSafe` / `validatePath`);
  - resolver symlinks con `fs.realpath` y repetir la comprobación sobre la ruta real;
  - responder 403 si falla cualquiera.
- Construir la URL `file://` con `pathToFileURL` en vez de concatenar texto.
- Evaluar quitar `bypassCSP` una vez que exista una CSP (1.4) que permita `media-src jamman:`.

**Criterios de aceptación.**

- Pedir `jamman://` con una ruta fuera de la carpeta del SD devuelve 403.
- Pedir un archivo que no es `.wav` devuelve 403.
- Un symlink dentro de la carpeta que apunta fuera devuelve 403.
- La reproducción de WAV de la app sigue funcionando, incluido el seek con range requests.
- Tests unitarios para el handler (ruta válida, traversal con `..`, extensión incorrecta, symlink, ruta vacía).

### 1.2 Verificar el origen de las llamadas IPC

**Problema.** Los handlers de `ipcMain.handle` reciben rutas del renderer y no comprueban quién llama.

**Cambios.**

- Crear un helper `assertTrustedSender(event)` que verifique que `event.senderFrame.url` pertenece al origen de la app (URL del dev server en desarrollo, `file://` del renderer empaquetado en producción).
- Aplicarlo a todos los handlers. Lo más limpio es hacerlo al envolver el registro de handlers (ver fase 4).

**Criterios de aceptación.**

- Un handler invocado desde un frame no confiable lanza un error y no ejecuta la operación.
- Test unitario con un `event` simulado de origen válido y otro inválido.

### 1.3 Activar `sandbox: true`

**Problema.** `WindowManager.ts` usa `sandbox: false` con el comentario "para permitir acceso a Node en el preload". El preload solo expone `ipcRenderer` mediante `contextBridge`.

**Cambios.**

- Poner `sandbox: true` en `webPreferences` de `packages/main/src/modules/WindowManager.ts`.
- Revisar `packages/preload/src/` por usos de módulos de Node que no estén disponibles en un preload sandboxed (por ejemplo `nodeCrypto.ts`). Reemplazarlos o moverlos al main.

**Criterios de aceptación.**

- La app arranca y todas las funciones que dependen del preload (leer patches, diálogos, backup, playlists, exportar) funcionan con `sandbox: true`.
- El build del preload sigue generando un bundle válido para el sandbox.

### 1.4 Content Security Policy

**Cambios.**

- Agregar una CSP al `packages/renderer/index.html` o, mejor, por cabecera desde el main con `session.webRequest.onHeadersReceived`.
- Política base: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' jamman:; connect-src 'self'` (más el origen del dev server solo en desarrollo). Ajustar `style-src` según lo que requieran Bootstrap, reactstrap y styled-components.

**Criterios de aceptación.**

- La app funciona sin errores de CSP en la consola, en desarrollo y en producción.
- Un script inline inyectado en el renderer queda bloqueado.

### 1.5 Entitlements de macOS

**Problema.** `buildResources/entitlements.mac.plist` incluye `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`, `disable-library-validation`, `device.usb` y `device.audio-input`, que probablemente no se necesitan.

**Cambios.**

- Quitar todos los entitlements que no sean necesarios. Mantener `allow-jit` (Electron lo requiere) y `files.user-selected.read-write`.
- Probar un build firmado localmente para confirmar que la app abre. Si algo falla, volver a agregar solo el entitlement que lo resuelva y documentar por qué.

**Criterios de aceptación.**

- El `.plist` queda con el mínimo necesario y cada entitlement tiene un comentario o una nota en `BUILD.md` que lo justifica.

### 1.6 Validación de `setWindowOpenHandler` y navegación

**Cambios.**

- Confirmar que `webContents.setWindowOpenHandler` deniega por defecto y que solo se abren URLs externas permitidas con `shell.openExternal`.
- Reemplazar la lista de URLs de ejemplo del boilerplate (`index.ts:117-125`: vite.dev, solidjs.com, qwik.dev, lit.dev, vuejs.org…) por las que la app realmente necesita, o por un conjunto vacío.

**Criterios de aceptación.**

- Ninguna URL del boilerplate queda en el código.

---

## Fase 2: CI que realmente bloquee

**Problema.** `.github/workflows/ci.yml` tiene `continue-on-error: true` en typecheck, lint, tests, formato y auditoría. La CI nunca falla. Además conviven tres sistemas de workflows: `ci.yml` propio, `boilerplate-ci-entry.yml` y `deploy.yml` del boilerplate.

**Cambios.**

- Quitar `continue-on-error` de typecheck, lint, tests y formato en `ci.yml`.
- Dejar la auditoría como bloqueante solo para dependencias de producción: `npm audit --omit=dev --audit-level=high`.
- Fijar Node en 24 LTS (ver 3.3).
- Decidir si se conserva el flujo de release del boilerplate (`boilerplate-ci-entry.yml` + `compile-and-test.yml` + `deploy.yml`) o el propio `release.yml`. Dejar uno solo y borrar el otro. `release.yml` usa `actions/create-release@v1`, que está archivada.
- Subir las versiones de acciones a una sola generación (`checkout@v5`, etc.) y fijarlas.
- Añadir protección de rama en `main` que exija que `ci.yml` pase (configuración de GitHub, no de código).

**Criterios de aceptación.**

- Un PR con un error de tipos, un fallo de lint o un test roto falla la CI.
- Solo existe un workflow de build/test y uno de release.

---

## Fase 3: Dependencias y runtime

### 3.1 Actualizar Electron

**Problema.** `electron` está fijado en `39.0.0`. Electron solo da parches de seguridad a las últimas tres versiones mayores y hoy la última es la 45.

**Cambios.**

- Subir Electron a la última versión estable en pasos (revisar las notas de breaking changes de cada mayor). Si hay cambios incompatibles en `protocol`, `net` o `session`, corregirlos en el main.
- Verificar `electron-versions` y la configuración de build tras la subida.
- Mantener fijado el número exacto, pero documentar la política: revisar la versión de Electron cada trimestre.

**Criterios de aceptación.**

- La app compila y arranca, el audio se reproduce, los diálogos y el auto-update funcionan.
- Los e2e pasan contra el build nuevo.

### 3.2 Corregir vulnerabilidades de producción

`npm audit` reportaba 51 vulnerabilidades (4 críticas, 35 altas); 12 afectan a dependencias de producción.

**Cambios.**

- Subir `adm-zip` a una versión sin las vulnerabilidades reportadas (bomba de descompresión, sobrescritura vía symlinks, bits SUID/SGID, entradas duplicadas). Si no existe versión corregida, evaluar un reemplazo (`yauzl` para lectura y `yazl` o `archiver` para escritura).
- Subir `electron-updater` para que arrastre un `builder-util-runtime` corregido.
- Ejecutar `npm audit fix` y revisar a mano lo que requiera `--force`.
- Añadir validación propia al restaurar backups, aunque se actualice la librería:
  - rechazar entradas cuyo nombre resuelto salga del directorio destino (Zip Slip);
  - fijar un límite de tamaño descomprimido total y por entrada;
  - rechazar entradas duplicadas;
  - no preservar permisos del archivo.
    Esto va en `packages/main/src/BackupManager.ts` (`getEntries`, extracción en torno a las líneas 149-260).

**Criterios de aceptación.**

- `npm audit --omit=dev` no reporta severidad alta ni crítica.
- Tests de `BackupManager` con ZIPs maliciosos: ruta con `..`, entrada enorme, entradas duplicadas, symlink.

### 3.3 Versión de Node

**Cambios.**

- Cambiar `engines.node` de `>=23.0.0` a `>=24` (LTS) en el `package.json` raíz.
- Agregar `.nvmrc` con `24`.
- Alinear la matriz de CI.
- Actualizar `README.md` y `BUILD.md`.

### 3.4 Dependencias sin uso o mal ubicadas

**Cambios.**

- Eliminar `react-window` (raíz) y `wavesurfer.js` (renderer); no se usan en ninguna parte.
- Revisar `styled-components`, `classnames` y `react-tooltip`: cada uno aparece en un solo archivo. Mantenerlos solo si aportan valor real.
- Reemplazar `uuid` por `crypto.randomUUID()` (3 usos).
- Mover `@types/pdfkit` a `devDependencies`.
- Mover las dependencias de runtime del main (`electron-log`, `fs-extra`, `music-metadata`, `pdfkit`, `uuid`, `xml2js`) al `package.json` de `packages/main`, que es el paquete que las usa.
- Añadir `@vitest/coverage-v8` a `devDependencies` para que `npm run test:coverage` funcione.

### 3.5 Actualizaciones menores

- Actualizar a las versiones "wanted" de `eslint`, `@eslint/js`, `@playwright/test`, `electron-builder`, `electron-log`, `fs-extra`, `@types/react` y `@types/react-dom`.
- Evaluar los saltos mayores (`eslint` 10, `vitest` 5, `@vitejs/plugin-react` 6, `globals` 17) en un PR separado.

### 3.6 Dependabot

- Cambiar la frecuencia de npm de diaria a semanal.
- Agrupar actualizaciones menores y de parche (`groups`).
- Quitar `versioning-strategy: increase` salvo que haya una razón concreta.

---

## Fase 4: Refactor de `index.ts` y pruebas reales

**Problema.**

- `packages/main/src/index.ts` tiene 1487 líneas y concentra todos los handlers IPC.
- `index.test.ts` e `ipc.integration.test.ts` mockean Electron y no importan `index.ts`. Solo `PathValidator` y `SecureXMLParser` se prueban con código real.
- `BackupManager`, `PlaylistManager`, `LockManager` y `OperationQueue` no tienen tests.

### 4.1 Dividir los handlers por dominio

Crear `packages/main/src/ipc/` con un archivo por dominio y un registro central:

- `dialogs.ts` (`dialog:selectFolder`, `dialog:selectFile`, `backup:selectFile`)
- `patches.ts` (`patches:read|create|update|delete|deleteBatch|reorder`, caché de patches)
- `audio.ts` (`phrase:getAudioURL`, `audio:validateWav`, `audio:readFile`, protocolo `jamman://`)
- `export.ts` (`patches:exportTXT|exportPDF`)
- `backup.ts` (`backup:*`)
- `playlists.ts` (`playlists:*`)
- `queue.ts` (`operation-queue:*`)
- `register.ts` con una función `registerIpcHandlers(deps)` que aplica `assertTrustedSender` (1.2) y un manejo de errores común.

Cada módulo debe exportar funciones puras que reciban sus dependencias (fs, logger, managers) para poder probarlas sin Electron. `index.ts` debe quedar reducido a la composición de módulos.

**Criterios de aceptación.**

- `index.ts` queda por debajo de 150 líneas.
- Ningún cambio de comportamiento: mismos nombres de canal y mismas respuestas.

### 4.2 Tipar el contrato IPC

- Definir en un solo lugar (por ejemplo `packages/preload/src/ipc-contract.ts`) los canales con sus argumentos y su tipo de retorno, y usarlo en main, preload y renderer.
- Reemplazar los `any` residuales de `index.ts` (por ejemplo `patches: any[]` en el caché) y los de los 29 warnings de lint por tipos reales.
- Considerar validar los argumentos que llegan del renderer con un esquema (por ejemplo `zod`), no solo con `typeof`.

### 4.3 Tests con código real

- Reescribir los tests de integración para importar y ejecutar los handlers reales (con `fs` sobre un directorio temporal y Electron mockeado solo en los bordes). Eliminar los tests que reimplementan la lógica en vez de probarla.
- Añadir tests nuevos:
  - `BackupManager`: crear, validar, restaurar en modo reemplazar y modo mezclar, ZIP corrupto, ZIP malicioso (ver 3.2).
  - `PlaylistManager`: crear, editar, borrar, reordenar, exportar, JSON corrupto.
  - `LockManager`: adquirir, liberar, concurrencia, bloqueo huérfano.
  - `OperationQueue`: prioridades, errores, estadísticas.
  - Handlers de patches: reorder con fallo a medias (rollback), borrado en lote con éxito parcial.
- Dejar un conjunto de fixtures de un SD de JamMan en `tests/fixtures/`, idealmente copiado de una tarjeta real, y usarlo en los tests.

**Criterios de aceptación.**

- `npm run test:coverage` corre y cumple los umbrales actuales (70%) sobre código real del main.
- Los tests nuevos fallan si se rompe la lógica que prueban.

### 4.4 E2E

- Verificar que `npm run test:e2e` corre localmente y en CI contra el instalador construido. Si no, arreglar los e2e o documentar el requisito de build previo.
- Añadir los e2e a un job de CI (al menos en una plataforma) tras el build.

---

## Fase 5: Deuda funcional

### 5.1 Completar el undo

**Problema.** `packages/renderer/src/utils/undoHandler.ts:87-102` tiene cuatro TODOs: restaurar patch borrado, restaurar borrado en lote, deshacer una edición de patch y deshacer una restauración de backup. La UI promete undo y esas acciones destructivas no lo tienen.

**Cambios.** Implementar cada caso apoyándose en los backups automáticos previos a la operación. Si alguno no es viable, deshabilitar el undo para esa acción y avisarlo en la UI en lugar de dejarlo en silencio.

**Criterios de aceptación.**

- Borrar un patch y pulsar Cmd+Z lo restaura con sus frases y audios.
- Lo mismo para el borrado en lote y la edición de patch.
- Tests del store de undo para cada caso.

### 5.2 Versión de la app en los backups

- `BackupManager.ts:69` fija `appVersion: '0.1.0'`. Leer la versión con `app.getVersion()` e inyectarla.
- Añadir `schemaVersion` al `manifest.json` y a `.jamman-playlists.json`, con una función de migración, para no romper backups o playlists antiguos cuando cambie el formato.

### 5.3 Audio

- Retirar los restos de WaveSurfer (dependencia y referencias en docs).
- Documentar en `BUILD.md` o en un ADR por qué se usa un protocolo propio y qué restricciones de seguridad tiene (1.1).

### 5.4 Pruebas con hardware real

- Documentar un protocolo manual de pruebas contra una tarjeta SD de un JamMan Stereo real antes de cada release (leer, reordenar, borrar, restaurar un backup y comprobar en el pedal).

---

## Fase 6: Limpieza del boilerplate y del repositorio

- Quitar del `package.json` raíz los scripts que ya no aplican: `init`, `create-renderer`, `integrate-renderer`. Borrar el paquete `packages/integrate-renderer` y la acción `.github/actions/init-template-with-renderer` si nada más los usa.
- Quitar del control de versiones `.idea/` y `.DS_Store`, y añadirlos a `.gitignore` (`git rm -r --cached .idea .DS_Store`).
- Eliminar el bloque `build` duplicado dentro de `package.json`, ya que `electron-builder.mjs` es la fuente de verdad.
- Mover `IMPROVEMENT_PLAN.md` y `QUICK_WINS_IMPLEMENTED.md` a `docs/` o convertir sus pendientes en issues. Actualizar los estados que ya no son ciertos (el plan marca como "completado" lo que los hallazgos de esta revisión contradicen, por ejemplo el endurecimiento de seguridad).
- Añadir `CHANGELOG.md`.
- Resolver los 29 warnings de lint y, cuando queden a cero, volver `no-explicit-any` a `error` en el renderer (`0e8147b` lo bajó a warning de forma temporal).
- Añadir un hook `pre-push` o un script `npm run verify` que ejecute typecheck, lint y tests.

---

## Fase 7: Firma y distribución

- **macOS:** configurar firma con Developer ID y notarización (`notarize` en electron-builder). Sin esto el auto-update no funciona y Gatekeeper bloquea la app.
- **Windows:** configurar firma de código (certificado o Azure Trusted Signing). Valorar si las dos arquitecturas `x64` e `ia32` siguen siendo necesarias.
- **Linux:** revisar si se mantienen los tres formatos (`AppImage`, `deb`, `rpm`) o se reducen.
- Guardar los secretos de firma en los secretos de GitHub Actions, nunca en el repositorio.
- Probar el flujo de auto-update de extremo a extremo entre dos versiones (con `VITE_DISTRIBUTION_CHANNEL` si se usan canales).

---

## 8. Mejoras opcionales a valorar

- Compilador de React (`babel-plugin-react-compiler`) para evitar `memo` manual.
- Validación de argumentos IPC con `zod`.
- Un ADR por decisión importante (protocolo propio, sandbox, formato de backup y de playlists) en `docs/adr/`.

## 9. Definición de terminado

- [ ] `npm run typecheck`, `npm run lint` y `npm test` pasan sin warnings de `any`.
- [ ] `npm run test:coverage` corre y cumple los umbrales.
- [ ] `npm audit --omit=dev` no reporta severidad alta ni crítica.
- [ ] La CI falla ante errores de tipos, lint, tests o vulnerabilidades altas de producción.
- [ ] El protocolo `jamman://` solo sirve `.wav` de la carpeta del SD elegida.
- [ ] `sandbox: true` y una CSP activos, y la app funciona igual.
- [ ] Electron actualizado a una versión con soporte.
- [ ] `index.ts` dividido y los handlers cubiertos por tests con código real.
- [ ] Undo completo o deshabilitado explícitamente donde no sea viable.
- [ ] Instaladores firmados y notarizados, con auto-update probado.
- [ ] Restos del boilerplate, `.idea/` y `.DS_Store` fuera del repositorio.

## 10. Riesgos

- **Subir Electron varias versiones mayores:** puede romper `protocol`, `net` o `session`. Mitigar subiendo en pasos y con los e2e funcionando antes de empezar.
- **`sandbox: true`:** el preload deja de poder usar módulos de Node. Mitigar revisando `nodeCrypto.ts` antes de activarlo.
- **Refactor de `index.ts`:** riesgo de regresiones en operaciones que escriben en el SD. Mitigar con tests reales (4.3) antes de mover código y con pruebas manuales contra una tarjeta real (5.4).
- **Sustituir `adm-zip`:** cambia el formato de uso en `BackupManager`. Mitigar con tests de backup/restauración sobre archivos generados con la versión actual, para garantizar compatibilidad hacia atrás.
