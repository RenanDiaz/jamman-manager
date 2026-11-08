# Protocolo USB del JamMan Stereo ("Greenglass")

- **Fecha:** 2026-11-08
- **Estado:** lectura y escritura verificadas con un pedal real (JamMan Stereo, firmware 1.3), en una carpeta de prueba de la SD
- **Cliente de prueba:** [`tools/greenglass.py`](../tools/greenglass.py) (Python 3, sin dependencias)

## Resumen

El JamMan Stereo **no se monta como disco** por USB. Se presenta como un dispositivo de comunicaciones CDC-ACM (como un módem). En macOS aparece como `/dev/cu.usbmodemXXXX`. Por ese puerto habla un protocolo binario que DigiTech llamó _Greenglass_. El protocolo incluye una API de archivos completa: listar carpetas, consultar, abrir, leer, escribir, crear, mover y borrar. Con ella se puede acceder a la memoria interna y a la SD del pedal sin sacar la tarjeta.

| Dato                 | Valor                                                     |
| -------------------- | --------------------------------------------------------- |
| USB vendor / product | `0x1210` / `0x0020`                                       |
| Clase USB            | `2` (CDC), interfaces ACM control + data                  |
| Nodo en macOS        | `/dev/cu.usbmodem101` (el número cambia según el puerto)  |
| Velocidad medida     | ~1.3 MB/s leyendo y ~1.4 MB/s escribiendo (2 MB en la SD) |

## De dónde sale

El protocolo se obtuvo descompilando JamManager 1.1.12 para Mac, el instalador oficial archivado en web.archive.org desde `digitech.com/en-US/softwares/jammanager-v1112-mac/download`. Se analizó sin ejecutarlo.

- JamManager era una app de Silverlight (`Hmg.Device.JamMan.xap`) que hablaba por TCP con un host nativo. El host reenviaba los mensajes al pedal por el puerto serie.
- El kext del instalador (`DigitechJamMan.kext`) apunta exactamente a `0x1210/0x0020`, el mismo pedal.
- Las clases relevantes están en `Hmg.WebApp.Framework.dll`, en los espacios de nombres `Hmg.WebApp.Framework.Greenglass` y `Hmg.Device.Greenglass`.
- Por el socket TCP, cada mensaje lleva delante un `int64` con el handle del endpoint. **Por el puerto serie ese prefijo no existe:** el pedal manda y recibe el mensaje desnudo.

## Transporte

- Abrir el puerto en modo raw (8N1). La velocidad no importa porque es CDC; se usó 115200.
- Al abrir el puerto, el pedal manda por su cuenta varias `PropertyChangedNotification` (estado del disco y patch actual). Hay que vaciarlas antes de esperar respuestas. Mientras se escribe, también avisa de cada cambio en `KilobytesAvailableOnSd`.
- **Cada trama tiene que salir completa.** El parser del pedal no tiene resincronización ni timeout: si una trama llega incompleta, toma los bytes que lleguen después (incluidas las peticiones siguientes) como el resto de su payload, y deja de contestar. Con el descriptor en modo no bloqueante, un `write` de una trama de 8 KB envió solo ~1 KB. Hay que repetir el `write` hasta enviar todo (en Node, esperar al callback de `port.write` / `drain`).
- **Recuperación** si el parser queda desfasado: mandar bytes `0x00` de a uno hasta que llegue la respuesta pendiente. Esos bytes completan el payload en espera. Si la trama cortada era un `FileWriteRequest`, los ceros terminan dentro de ese archivo. Después, un `WhoAmI` confirma que el parser volvió a estar alineado. Se probó una vez: hicieron falta 6564 ceros. Desconectar el cable no se probó como alternativa.

## Formato de mensaje

Todo es little endian.

```
u16  msgID
u32  payloadLength
u8[] payload
```

- **Peticiones:** el payload empieza con un `u32` de número de serie que elige el cliente.
- **Respuestas** (`msgID < 0x8000`): el payload empieza con el mismo número de serie.
- **Notificaciones** (`msgID >= 0x8000`): llegan en cualquier momento, sin número de serie.
- **Strings:** `i32` con la longitud en bytes, seguido de UTF-8, sin terminador.
- **Booleanos:** 1 byte.
- **Tamaño máximo de payload:** 8178 bytes. Por eso los bloques de lectura son de 8162 bytes y los de escritura de 8158.

### Mensajes

| ID     | Nombre                        | Payload después del serial                                                                                                                                                                      |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | WhoAmIRequest                 | (nada)                                                                                                                                                                                          |
| 1      | WhoAmIResponse                | `u16 family` (93 = JamMan), `u16 product` (3 = Stereo), `u16 ?`, `u16 softwareVersion` (BCD), `str guid`, `str name`                                                                            |
| 2      | SuccessResponse               | (nada)                                                                                                                                                                                          |
| 3      | FailureResponse               | `str errorMessage`                                                                                                                                                                              |
| 4      | FileSystemEntryInfoRequest    | `bool isFolder`, `str path`                                                                                                                                                                     |
| 5      | FileSystemEntryInfoResponse   | `bool isFolder`, `str fullName`, `bool exists`, `i64 size`, `bool readOnly`, `bool hidden`, 3 fechas (creación, modificación, acceso), cada una `i16 año, i8 mes-1, i8 día, i8 hora, i8 minuto` |
| 6      | FileSystemEntrySetInfoRequest | `bool isFolder`, `str path`, `bool readOnly`, `bool recursive`, 3 fechas                                                                                                                        |
| 7      | FileSystemEntryCreateRequest  | `bool isFolder`, `str path`, `bool overwriteExisting`                                                                                                                                           |
| 8      | FileSystemEntryMoveRequest    | `bool isFolder`, `str src`, `str dst`, `bool keepOriginal`, `bool overwriteExisting`                                                                                                            |
| 9      | FileSystemEntryDeleteRequest  | `bool isFolder`, `str path`, `bool recursive`, `bool moveToTrash`                                                                                                                               |
| 10     | FileOpenRequest               | `str path`, `u8 access` (1 = lectura, 2 = escritura; lectura y escritura a la vez no se permite), `u8 mode` (0 = crear o truncar, 1 = abrir existente)                                          |
| 11     | FileOpenResponse              | `i64 handle`, `i64 size`                                                                                                                                                                        |
| 12     | FileReadRequest               | `i64 handle`, `i32 count` (≤ 8162)                                                                                                                                                              |
| 13     | FileReadResponse              | `i64 handle`, `i32 n`, `u8[n] data`                                                                                                                                                             |
| 14     | FileWriteRequest              | `i64 handle`, `i32 n`, `u8[n] data` (≤ 8158); responde Success                                                                                                                                  |
| 15     | FileSeekRequest               | `i64 handle`, `i64 offset`, `u8 origin` (0 = inicio, 1 = actual, 2 = final)                                                                                                                     |
| 16     | FileCloseRequest              | `i64 handle`; responde Success                                                                                                                                                                  |
| 17     | FolderContentsRequest         | `str path`                                                                                                                                                                                      |
| 18     | FolderContentsResponse        | `i32 nFiles`, `str[] files`, `i32 nDirs`, `str[] dirs`                                                                                                                                          |
| 19     | GetPropertiesRequest          | `u8 pathLen` (0), `u16[] path`                                                                                                                                                                  |
| 20     | GetPropertiesResponse         | `i16 nInt`, `{u16 id, i32 value}[]`, `i16 nStr`, `{u16 id, str value}[]`                                                                                                                        |
| 21     | SetPropertyRequest            | `u8 pathLen`, `u16[] path`, `u16 id`, `i32` o `str`                                                                                                                                             |
| 22     | IssueCommandRequest           | `u16 command`, `i64 argument`                                                                                                                                                                   |
| 25     | EndPointDisconnectRequest     | (nada)                                                                                                                                                                                          |
| 26     | GetPropertyRequest            | `u8 pathLen`, `u16[] path`, `u16 id`                                                                                                                                                            |
| 27     | GetPropertyResponse           | `u16 id`, `i32` (id ≤ 17) o `str`                                                                                                                                                               |
| 0x8006 | PropertyChangedNotification   | `u8 pathLen`, `u16[] path`, `u16 id`, `i32` (id ≤ 17) o `str`                                                                                                                                   |

Los IDs 23 y 24 (lanzar procesos) y las notificaciones `0x8000` a `0x8005` eran para el host de escritorio, no para el pedal.

### Propiedades

Las propiedades con ID ≤ 17 son enteras y las de ID ≥ 32768 son strings. Valores leídos del pedal real:

| ID            | Propiedad                                 | Valor                                          |
| ------------- | ----------------------------------------- | ---------------------------------------------- |
| 1 / 2         | FamilyID / DeviceID                       | 93 / 3                                         |
| 3             | ProtocolVersion                           | 1                                              |
| 4             | FirmwareVersion                           | 4864 (`0x1300` = 1.3.0.0)                      |
| 5             | RemovableMediaIsPresent                   | 1                                              |
| 6 / 7 / 8     | SampleRate / ChannelCount / BitDepth      | 44100 / 2 / 16                                 |
| 10 / 11       | KB libres / capacidad en NAND             | 415096 / 516608                                |
| 12 / 13       | KB libres / capacidad en SD               | 26653408 / 31154688                            |
| 14            | DiskState                                 | 0 (al abrir el puerto pasa por 1 y vuelve a 0) |
| 15            | CurrentBankAndPatch                       | 1 (se vio también `0x00010063`)                |
| 16 / 17       | AudioIsDirty / SettingsAreDirty           | 0 / 0                                          |
| 32775         | AppsFolderPath                            | `/mnt/nandfs/usr/`                             |
| 32776         | TempFolderPath                            | `/dev/shmem/`                                  |
| 32779         | InternalPatchFolderPath                   | `/mnt/nandfs/JamManStereo/`                    |
| 32780         | RemovablePatchFolderPath                  | `/mnt/sdfs/JamManStereo/`                      |
| 32788 / 32789 | QueueCurrentBehavior / QueueEmptyBehavior | `RevertToSaved` / `TransitionIfStopped`        |
| 32790–32792   | Botones izquierdo / medio / derecho       | `UndoRedo` / `Reverse` / `Tempo`               |

### Comandos (`IssueCommandRequest`)

`LoopEngineTest = 0x1000`, `LoopEngineReloadCurrentPatch = 0x1001`, `LoopEngineStopImmediately = 0x1002`. JamManager 1.1.12 no los usa. Para escribir le bastaba con las operaciones de archivo.

## Sistema de archivos del pedal

- **Memoria interna:** `/mnt/nandfs/JamManStereo/PatchNN/…`
- **SD:** `/mnt/sdfs/JamManStereo/PatchNN/…`

La estructura es la misma que ya maneja la app (`patch.xml`, `PhraseA/phrase.xml`, `PhraseA/phrase.wav`). JamManager cargaba el banco interno y, si `RemovableMediaIsPresent == 1`, también el de la SD. Si la carpeta de la SD no existía, la creaba.

## Escritura: qué se probó

Todo en `/mnt/sdfs/greenglass-test/`, fuera de `JamManStereo/`, y borrado al terminar:

| Prueba                                                                                      | Resultado                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Crear carpeta y subcarpeta (`7`)                                                            | OK                                                           |
| Escribir y releer archivos de 0, 100, 8158 (un bloque exacto), 8159 bytes y 2 MB            | OK, idénticos byte a byte, y `size` coincide                 |
| Abrir en modo "crear o truncar" sobre un archivo de 2 MB y escribir 10 bytes                | OK, queda de 10 bytes                                        |
| Nombre de archivo UTF-8 (`canción ñ.txt`)                                                   | OK, si la longitud del string se cuenta en bytes             |
| Escribir `target.xml.tmp` y moverlo sobre `target.xml` existente (`8`, `overwriteExisting`) | OK, el temporal desaparece                                   |
| Renombrar una carpeta que solo tiene archivos (`8`, `isFolder`)                             | OK                                                           |
| Mover o renombrar una carpeta que contiene carpetas (aunque estén vacías)                   | **Falla**: `The folder could not be copied.`                 |
| Mover un archivo a otra carpeta del mismo medio                                             | OK, instantáneo (es un renombre)                             |
| Copiar una carpeta o un archivo dentro del pedal (`8`, `keepOriginal`)                      | OK, ~1.2 MB/s (4 MB en 3.3 s): igual de lento que por USB    |
| Borrar una carpeta vacía sin `recursive`                                                    | OK                                                           |
| Borrar un archivo y borrar la carpeta de forma recursiva (`9`)                              | OK                                                           |
| Leer un archivo que no existe                                                               | `FailureResponse` con el mensaje `No such file or directory` |

No se probaron `SetInfo` (6), `SetProperty` (21) ni los comandos del loop engine.

**Mover carpetas.** Como el pedal no mueve carpetas con subcarpetas, y un `PatchNN/` siempre tiene `PhraseX/`, mover un patch se hace recreando las carpetas en el destino y moviendo los archivos uno por uno (`PedalFiles.moveTree`). JamManager tampoco movía carpetas: solo archivos. El pedal procesa las peticiones en orden aunque una tarde mucho: una copia de 20 MB dentro del pedal superó los 3 s de timeout de una prueba, y las peticiones que llegaron después se ejecutaron igual, más tarde.

Ojo: JamManager calculaba el campo de longitud con `string.Length` (caracteres, no bytes), así que con nombres no ASCII enviaba tramas mal formadas. El cliente de prueba cuenta bytes.

## Precauciones antes de escribir

- **Un archivo borrado mientras sigue abierto no libera su espacio** hasta que se cierra su handle o se apaga el pedal (el pedal corre Linux). En la prueba fallida quedó un handle abierto: 32 KB de la SD siguen ocupados hasta el próximo apagado. Hay que cerrar siempre los handles (`FileCloseRequest`), también si hay errores.
- **No tocar `/mnt/nandfs/usr/`** (`AppsFolderPath`). Ahí vive el software del pedal, y el actualizador de JamManager escribía el firmware en esa carpeta con las mismas operaciones de archivo.
- JamManager escribía `patch.xml` y `phrase.xml` abriendo en modo "crear o truncar" y mandando bloques. Para no dejar un archivo a medias si se corta el cable, es más seguro escribir a un nombre temporal y luego mover con `FileSystemEntryMoveRequest` (`overwriteExisting = true`).
- Conviene no escribir el patch que está cargado (`CurrentBankAndPatch`) mientras el pedal graba o reproduce.

## Integración en la app

La app trabaja en vivo sobre el pedal. No hay copia local: lo único que guarda es una caché de los WAV ya descargados. El código está en `packages/main/src/usb/`.

| Etapa | Alcance                                               | Estado |
| ----- | ----------------------------------------------------- | ------ |
| 1     | Conectar, listar patches y reproducir                 | Hecha  |
| 2     | Editar metadatos, borrar y reordenar                  | Hecha  |
| 3     | Agregar, reemplazar y quitar frases; crear patches    | Hecha  |
| 4     | Backup, restore y "Descargar todo el banco"           | Hecha  |
| 4b    | Playlists                                             | Hecha  |
| 5     | Control en vivo del pedal (fase adicional, ver abajo) | Hecha  |

Decisiones de la etapa 1:

- **Rutas virtuales.** Un banco del pedal es `jamman-pedal://internal` o `jamman-pedal://sd`, y una frase es `jamman-pedal://sd/PatchNN/PhraseX/phrase.wav`. Los handlers que entienden esas rutas están en `PEDAL_AWARE_CHANNELS` (`ipc/register.ts`). El resto las rechaza con un mensaje claro antes de ejecutarse.
- **Una petición a la vez.** `GreenglassClient` encola las peticiones. Un timeout o una trama corrupta cierran la conexión, porque el parser del pedal no se puede resincronizar.
- **Al conectar se descarta lo que llegue** hasta que la línea quede en silencio. Si una sesión anterior se cortó a mitad de una respuesta, el pedal sigue enviando el resto al reconectar. Se vio con el pedal real: sin este paso, la conexión fallaba con "Corrupt data from the pedal".
- **Al desconectar se deja terminar la petición en curso** (hasta 1 s) antes de cerrar el puerto, por la misma razón.
- **El audio se transmite en vez de descargarse antes de reproducir.** `jamman://pedal/…` lee del pedal con `FileSeek` + `FileRead`, así que la reproducción empieza enseguida: un WAV de 155 s (27 MB) de la SD sonó en ~1 s. Si la petición cubre el archivo entero (lo normal en la primera reproducción), se escribe a la caché a medida que pasa, y se conserva solo si se leyó completo. Una reproducción cortada no deja nada en caché, y la siguiente vuelve a transmitir.
- **La caché se valida** con el tamaño y la fecha de modificación que reporta el pedal, en `userData/pedal-cache/<guid>/<banco>/PatchNN/PhraseX/phrase.wav`.
- **Tiempos medidos** con el pedal real: el banco interno (10 patches) carga en ~0.8 s y la SD (86 patches) en ~6 s.
- **Pruebas de hardware:** `JAMMAN_USB=1 npx vitest run --no-file-parallelism packages/main/src/usb/*.hardware.test.ts`. `PedalManager` solo lee. `PedalEditor` escribe únicamente en un banco de prueba en `/mnt/sdfs/.jamman-manager/hwtest/` y lo borra al terminar. `--no-file-parallelism` hace falta porque el puerto no se puede abrir dos veces.

Decisiones de la etapa 2:

- **Zona de escritura acotada.** Toda escritura, borrado o movimiento pasa por un guardia (`createWriteGuard` en `PedalFiles.ts`). Solo acepta `<banco>/PatchNN/…` y la carpeta de trabajo de la app en el mismo medio, `<medio>/.jamman-manager/`. La raíz de la memoria interna también tiene `usr/`, `lib/`, `boot/` y `jamStereo.xml`, que nunca se tocan.
- **Editar** reescribe `patch.xml` y los `phrase.xml` (temporal + mover) y conserva los IDs de cada frase. Las frases no se pueden agregar, quitar ni cambiar de WAV en esta etapa: el handler lo rechaza y el formulario oculta esos controles.
- **Reordenar** solo mueve los patches que cambian de nombre, y cada uno va directo a su nombre nuevo en cuanto está libre. Solo pasan por `.jamman-manager/reorder/` los que forman un ciclo, uno por ciclo. Cada paso cae en un nombre libre, así que un fallo se deshace repitiendo los pasos al revés. Si encuentra patches de un reordenamiento interrumpido en esa carpeta, se niega a empezar.
- **Deshacer sin mover audio por el cable.** Ver la etapa 3: el mecanismo de la etapa 2 (estacionar la carpeta entera del patch borrado) se generalizó a archivos.
- **Tiempos medidos** con el pedal real, desde la app: editar ~0.8 s, deshacer o rehacer ~0.8 s, borrar ~1 s, recuperar un borrado ~0.8 s. Cada petición de escritura tarda ~22 ms, así que reordenar depende de cuántos patches cambian de lugar.

Decisiones de la etapa 3:

- **Crear y editar con audio.** Una frase cuyo WAV es un archivo del computador se sube (frase nueva o reemplazo). Una frase del pedal que el formulario ya no lista se quita. Crear un patch es lo mismo sobre un puesto vacío: `patch.xml` se escribe al final, así que la carpeta no es un patch hasta que está completa, y si algo falla se borra. Los WAV del computador pasan por la misma política de acceso que en modo local (elegidos en el diálogo o dentro de la carpeta aprobada). Un WAV de otro patch del pedal se rechaza.
- **Primero se sube, después se cambia.** Al editar, cada WAV nuevo se sube primero junto a su destino (`phrase.wav.tmp`). Si una subida falla, el patch queda como estaba y el temporal se borra.
- **Deshacer con referencias a archivos.** Una instantánea guarda localmente los XML del patch y una referencia a cada `phrase.wav`. La referencia sigue al archivo físico: en su carpeta, renombrado por un reordenamiento, o estacionado en `.jamman-manager/undo/<id>.wav` en el mismo medio. Antes de destruir un WAV que alguna instantánea necesita (reemplazarlo, quitar su frase, borrar su patch), se estaciona en lugar de borrarlo, lo que es instantáneo. Restaurar una instantánea devuelve sus WAV y estaciona lo que reemplazan, así que deshacer y rehacer intercambian estados las veces que haga falta sin pasar audio por el cable. Un WAV estacionado que ya ninguna instantánea necesita se borra, y la carpeta `undo/` se borra cuando queda vacía.
- **Progreso.** Las subidas avisan su avance (`pedal:progress`), que se muestra en el formulario y en el panel de trabajo.
- **Tiempos medidos** con el pedal real: subir un WAV va a ~1.5 MB/s. Crear un patch con un WAV de 4.6 MB tardó 4.1 s desde la app; deshacer el reemplazo de un WAV, 0.3 s.

Decisiones de la etapa 4:

- **Backup.** La app pregunta primero dónde guardar. Después baja a la caché los WAV del banco que aún no estén (con progreso y botón para detener), arma una carpeta temporal con la misma estructura que la tarjeta (XML del pedal y WAV enlazados desde la caché) y se la pasa al mismo `BackupManager` del modo local. El ZIP es idéntico al de una tarjeta.
- **Restore.** `BackupManager` restaura en una carpeta temporal donde cada puesto ocupado del pedal tiene una carpeta vacía de relleno, así que el modo merge numera igual que en una tarjeta. Después los patches restaurados se suben al pedal. En el modo replace, antes se borran los del pedal (sus WAV quedan estacionados para el deshacer). El deshacer usa una instantánea de todo el banco, que incluye el archivo de playlists.
- **Descargar todo el banco** (botón "Audio" en el diálogo del pedal). Primero muestra cuánto falta y cuánto tardará, y recomienda el lector de tarjetas si el banco es grande: la SD de prueba, con 3.68 GB, tardaría unos 51 minutos. Se puede detener: los archivos completos quedan en la caché y la descarga sigue donde quedó. Un archivo a medias no se guarda.
- **La caché se invalida al cambiar un patch.** Las fechas del pedal tienen resolución de minutos, y dos loops del mismo tempo y largo pesan exactamente lo mismo. Por eso, tamaño y fecha no bastan para detectar un WAV reemplazado. El editor registra qué patches tocó (`takeTouched`) y la caché de esos patches se borra.
- **Desconectar vacía la papelera** de los dos bancos (y la carpeta `.jamman-manager/` si queda vacía), porque ninguna instantánea sobrevive a la conexión. La memoria interna tiene solo ~500 MB.

Lo que apareció al probar la etapa 4 con el pedal real:

- **Una escritura de `serialport` puede quedar a medias para siempre dentro de la app.** Si el sistema acepta solo parte de una trama (~1 KB de 8 KB), `serialport` espera un aviso de "puerto listo para escribir" para mandar el resto. Dentro de la app ese aviso a veces no llegó, y la trama quedó cortada en 1063 bytes. Pasó dos veces en tres restores; en Node y en un proceso de Electron aislado no se reprodujo. El pedal sí podía recibir: al mandarle los 7117 bytes que faltaban, los aceptó en el acto. **Solución:** `serialTransport` manda cada trama en trozos de 512 bytes y espera a que cada uno se transmita (`drain`) antes del siguiente, así nunca hay una escritura parcial. Cuesta un 15% de velocidad (1.5 → 1.3 MB/s). Después del cambio, tres restores seguidos pasaron.
- **Timeouts.** El de la respuesta cuenta desde que la trama terminó de salir, no desde que se encoló. Las peticiones que cambian el almacenamiento esperan hasta 30 s, porque la memoria flash puede tardar en borrar bloques, y enviar una trama tiene un límite de 60 s.
- **Resincronizar al conectar** (`GreenglassClient.resync`). Si el pedal no contesta una sonda `WhoAmI`, probablemente está esperando el resto de una trama que una sesión anterior dejó cortada. Primero se le mandan ceros en bloques de 256 bytes hasta que responda: eso completa la trama pendiente, y si era una escritura de archivo, los ceros van a parar a ese `.tmp`. Después se mandan ceros de a uno, como mucho seis: seis ceros son un `WhoAmI` vacío y el pedal lo responde, así que la primera respuesta marca el límite de una trama aunque el paso anterior haya mandado ceros de más. Lo medí en el pedal: responde a cada trama vacía y sigue funcionando normalmente. Con una trama de 8 KB cortada a propósito, se recuperó solo en 4.5 s. Una carpeta que solo tiene archivos `.tmp` cuenta como puesto libre al crear o restaurar un patch ahí.
- **Tiempos medidos desde la app**, con el banco interno (10 patches, 32 MB): backup 17.7 s, incluida la descarga; restore en modo merge 27.5 s, subiendo 24 MB; deshacer el restore 2.9 s. Con el audio ya en caché, exportar el banco tarda ~1.3 s.

Decisiones de las playlists (etapa 4b):

- **El mismo archivo que en una tarjeta:** `.jamman-playlists.json` en la carpeta del banco (`<banco>/.jamman-playlists.json`). La validación de rutas permite ese archivo exacto y su `.tmp`, nada más de la raíz del banco.
- **La misma lógica.** `PlaylistManager` ahora trabaja sobre un `PlaylistStore`: leer y escribir el archivo, el `<ID>` de un patch y todos los IDs. Hay una implementación local, que es el comportamiento anterior y pasa sus 74 tests sin cambios, y otra del pedal (`PedalManager.playlistStore`).
- **IDs sin releer el banco.** Las playlists guardan patches por `<ID>`. El pedal arma un índice carpeta → ID y nombre con lo que ya parsea `readPatches`, y solo lo descarta cuando un cambio toca patches. Sin ese índice, cada acción de playlists releería todos los `patch.xml` de la SD (~3 s).
- **Probado desde la app** con el banco interno: crear una playlist, agregarle patches, exportar el setlist (con los nombres leídos del pedal), leerla de vuelta al reabrir y borrarla.

## Fase adicional: control en vivo del pedal

Se hace después de la fase de escritura. Además de archivos, Greenglass ofrece propiedades, avisos en vivo y unos pocos comandos del motor de loops, y esta fase los aprovecha. Todo sale del código descompilado de JamManager 1.1.12 y de `tools/greenglass.py`.

### Ya probado en el pedal (bajo riesgo)

- `WhoAmI` (msg 0): modelo, firmware, GUID y nombre.
- `GetProperties` (msg 19): firmware, sample rate y bits, si hay SD, espacio libre y capacidad de la memoria interna y la SD, `DiskState`, `CurrentBankAndPatch`, `AudioIsDirty`, `SettingsAreDirty` y la configuración de los botones.
- `PropertyChanged` (notificación 0x8006): el pedal la envía sin que se le pida cuando cambia una propiedad. Formato: `u8 n`, después `n × u16` (ruta), `u16 propId` y el valor. El valor es `i32` si `propId ≤ 17`; si no, es un string.

### Alcance

1. **Escuchar notificaciones.** `PedalManager` mantiene un lector que separa las notificaciones (ID ≥ 0x8000) de las respuestas y las reenvía al renderer por IPC.
2. **Mostrar el estado en vivo:**
   - qué patch está activo en el pedal (`CurrentBankAndPatch`);
   - si se metió o se sacó la SD (`RemovableMediaIsPresent`); si se saca, se cierra o se refresca la vista de la SD;
   - el espacio libre (`KilobytesAvailableOn*`).
3. **Protección al escribir.** Antes de escribir en el patch activo, o si `AudioIsDirty` o `SettingsAreDirty` están activos, mostrar una advertencia: "el pedal tiene un loop sin guardar o está usando este patch".
4. **Recargar después de editar.** Al escribir en el patch activo, mandar `IssueCommand` (msg 22) con `LoopEngineReloadCurrentPatch` (0x1001) para que el pedal tome los cambios. Opcionalmente, mandar antes `LoopEngineStopImmediately` (0x1002).
5. **(Opcional, al final) Configuración global con `SetProperty` (msg 21):**
   - qué hace cada botón: `LeftButtonCommand`, `MiddleButtonCommand` y `RightButtonCommand` (32790–32792), con valores como `UndoRedo`, `Reverse` o `Tempo`;
   - el comportamiento de la cola: `QueueCurrentBehavior` y `QueueEmptyBehavior` (32788–32789).

### Sin probar: hay que validarlo con el pedal antes de implementarlo

- `SetProperty` e `IssueCommand` nunca se han enviado. Hay que probarlos primero con un script en `tools/`, igual que se hizo con la escritura: un cambio, leer el valor de vuelta y restaurarlo.
- `LoopEngineTest` (0x1000) no se usa.
- `SetInfo` (msg 6) tiene un error en el cálculo de la longitud en el serializador original. Fuera de alcance.

### Restricciones que siguen vigentes

- No escribir nunca en `/mnt/nandfs/usr/`. Ahí está el software del pedal, y así es como se actualiza el firmware.
- Cada frame debe enviarse completo. Si un frame queda a medias, el parser del pedal se desincroniza.
- Las notificaciones pueden llegar en medio de cualquier respuesta. El lector debe saltarlas sin perder la respuesta pendiente.

### Fuera de alcance (el protocolo no lo permite)

- Reproducir, grabar u overdub desde la app.
- Audio en tiempo real.
- MIDI.
- Ajustes de entrada y salida.

### Criterios de aceptación

- Al cambiar de patch con el pie, la app lo refleja en menos de 1 s.
- Al sacar la SD, la app lo indica sin errores.
- Al editar el patch activo, la app pide confirmación y después el pedal suena con los cambios sin tener que cambiar de patch.
- Si se implementa la configuración global: al cambiar un botón desde la app, el cambio persiste tras reiniciar el pedal.

### Validación con el pedal (antes de implementar)

Con `tools/greenglass.py` (comandos nuevos `getprop`, `setprop`, `command` y `watch`), siempre restaurando lo que se cambiaba:

- **`GetProperty` (msg 26):** devuelve una propiedad sola. Probado con todas las de la tabla.
- **`SetProperty` (msg 21):** `LeftButtonCommand` pasó de `UndoRedo` a `Reverse`, se leyó de vuelta y siguió en `Reverse` después de apagar y encender el pedal; después se restauró. No se guarda en `jamStereo.xml`. Solo se probaron valores que el propio pedal reporta (`UndoRedo`, `Reverse`, `Tempo`): no hay lista de valores válidos, y JamManager nunca usaba estas propiedades.
- **`IssueCommand` (msg 22):** `LoopEngineStopImmediately` (0x1002) y `LoopEngineReloadCurrentPatch` (0x1001) responden Success con el pedal en reposo, y el pedal sigue respondiendo con normalidad.
- **Los avisos (`PropertyChanged`) solo llegan después del saludo** (`WhoAmI` + `GetProperties`). Un oyente que solo escuchaba no recibió nada en 10 minutos de cambios de patch; después del saludo, cada aviso llegó al instante. La app saluda al conectar.
- **`CurrentBankAndPatch`:** los 16 bits altos son el banco (0 = interna, 1 = SD) y los bajos el número de patch (1–99). Al recorrer los patches hacia abajo desde el 1 de la interna llegó `0x00010063`, que es la SD, patch 99.
- **`DiskState`** vale 1 mientras el pedal carga un patch y vuelve a 0 al terminar.
- **Sacar la SD** genera `RemovableMediaIsPresent = 0` y la capacidad y el espacio libre de la SD en 0. Meterla de nuevo restablece los valores.
- **`AudioIsDirty` y `SettingsAreDirty`** no cambiaron en las pruebas (no hubo una grabación sin guardar mientras se registraba). Se manejan igual que las demás propiedades.

### Implementación

- **Estado en vivo.** `PedalInfo.live` (banco y patch cargados, `busy`, `audioDirty`, `settingsDirty`) sale de las propiedades y de cada aviso. El `PedalManager` reenvía al renderer (`pedal:changed`) los avisos de esas propiedades, de las de espacio y SD, y de las de botones. En la app, la fila del patch cargado muestra "On pedal", el detalle muestra "Loaded on the pedal", el encabezado dice qué tiene cargado el pedal y el LED Busy se enciende mientras el pedal carga.
- **Protección al escribir** (`confirmPedalWrite`, en el renderer). Antes de crear, editar, borrar, reordenar o restaurar algo que toca el patch cargado, o si el pedal tiene algo sin guardar, la app pregunta: "The pedal has an unsaved loop or is using this patch", con el detalle del caso. Si hay una grabación sin guardar en el patch cargado, avisa que la recarga la descarta. Deshacer y rehacer no vuelven a preguntar.
- **Recargar después de cambiar.** Cuando un cambio toca el patch cargado (lo sabe `takeTouched`), el `PedalManager` manda `LoopEngineStopImmediately` y después `LoopEngineReloadCurrentPatch`.
- **Botones del footswitch.** En el diálogo del pedal hay un selector por botón, que solo ofrece los comandos que el pedal reporta. La app lee el valor de vuelta después de escribirlo.
- **No implementado: el comportamiento de la cola** (`QueueCurrentBehavior` / `QueueEmptyBehavior`). Solo se conocen los valores actuales (`RevertToSaved`, `TransitionIfStopped`); sin una lista de valores válidos, ofrecer un selector sería adivinar.

### Criterios de aceptación: resultado con el pedal real

- **Cambiar de patch con el pie** se reflejó en la app (marca "On pedal" y encabezado) en una secuencia de 01 a 11, con cambios separados por 100–300 ms. El script de la prueba miraba la pantalla cada 100 ms, y cada cambio ya estaba ahí; el aviso del pedal llega en el momento.
- **Sacar la SD** con la memoria interna abierta no produjo errores. Si la vista abierta es la SD, la app la cierra y avisa (cubierto con el pedal simulado).
- **Editar el patch cargado** (reemplazar el WAV de un patch de prueba que el pedal tenía cargado) mostró la confirmación. Después el pedal sonó con el audio nuevo sin cambiar de patch: lo confirmaste comparándolo con el patch del que salía ese audio.
- **Configuración global:** la asignación de un botón persistió tras apagar y encender el pedal (probado con `tools/`, desde la app se usa el mismo `SetProperty`).

## Uso del cliente de prueba

```bash
python3 tools/greenglass.py /dev/cu.usbmodem101 info
python3 tools/greenglass.py /dev/cu.usbmodem101 ls /mnt/sdfs/JamManStereo/
python3 tools/greenglass.py /dev/cu.usbmodem101 stat /mnt/nandfs/JamManStereo/Patch01/PhraseA/phrase.wav file
python3 tools/greenglass.py /dev/cu.usbmodem101 get /mnt/nandfs/JamManStereo/Patch01/patch.xml patch.xml
# escritura (una barra final indica carpeta)
python3 tools/greenglass.py /dev/cu.usbmodem101 mkdir /mnt/sdfs/prueba/
python3 tools/greenglass.py /dev/cu.usbmodem101 put local.wav /mnt/sdfs/prueba/phrase.wav
python3 tools/greenglass.py /dev/cu.usbmodem101 mv /mnt/sdfs/prueba/phrase.wav /mnt/sdfs/prueba/otra.wav
python3 tools/greenglass.py /dev/cu.usbmodem101 rm /mnt/sdfs/prueba/
```

Solo un programa puede tener el puerto abierto a la vez.
