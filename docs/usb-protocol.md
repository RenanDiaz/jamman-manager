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

| Etapa | Alcance                                     | Estado    |
| ----- | ------------------------------------------- | --------- |
| 1     | Conectar, listar patches y reproducir       | Hecha     |
| 2     | Editar metadatos, borrar y reordenar        | Hecha     |
| 3     | Agregar o reemplazar frases                 | Pendiente |
| 4     | Backup, restore y "Descargar todo el banco" | Pendiente |

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
- **Deshacer sin mover audio por el cable.** La instantánea de un patch guarda localmente solo sus XML (unos KB), y eso alcanza para deshacer una edición. Si se borra un patch que tiene instantánea, su carpeta se mueve a `.jamman-manager/undo/<id>/PatchNN/` en el mismo medio. Deshacer la vuelve a mover, y un rehacer la estaciona de nuevo en la misma instantánea, así que el ciclo deshacer/rehacer funciona las veces que haga falta. Descartar la instantánea borra lo estacionado. Al conectar se borra lo que haya quedado de una sesión anterior, porque el historial vive en la memoria del renderer.
- **Tiempos medidos** con el pedal real, desde la app: editar ~0.8 s, deshacer o rehacer ~0.8 s, borrar ~1 s, recuperar un borrado ~0.8 s. Cada petición de escritura tarda ~22 ms, así que reordenar depende de cuántos patches cambian de lugar.

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
