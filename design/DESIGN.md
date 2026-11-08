# JamMan Manager · Sistema de diseño "Pedal"

La interfaz toma su material del propio **Digitech JamMan Stereo**. La idea es que la app se lea como el pedal:

| En el pedal                                             | En la app                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Chasis azul metálico                                    | Fondo de la app                                                                         |
| Panel de control negro con tornillos                    | Cabecera, panel de detalle, mapa de memoria, reproductor y diálogos (`Panel`, `Dialog`) |
| Serigrafía blanca en condensada negrita                 | Leyendas y nombres (`Legend`, títulos)                                                  |
| Pastilla blanca con la segunda función (SHIFT, DELETE…) | Atajo o acción secundaria de un botón (`Pill`)                                          |
| Display verde de 7 segmentos                            | Número de slot y tiempo (`SevenSegment` dentro de `DisplayWindow`)                      |
| LEDs rojo, verde y amarillo                             | Estados: selección, loop, reverse, tempo, tarjeta (`Led`)                               |
| Teclas de goma negras (EXIT, STORE…)                    | Acciones de la barra y del panel (`PanelKey`)                                           |
| Placas de footswitch en relieve                         | Cada patch de la lista y de la vista de ordenar (`Plate`)                               |
| Switch cromado                                          | Reproducir (`StompButton`)                                                              |
| Perillas negras con escala impresa                      | Valores con posiciones fijas, como el ritmo (`Knob`)                                    |
| Columna de LEDs con su leyenda (Stop / Finish / Fade)   | Elegir una opción entre pocas (`ChoiceGroup`)                                           |
| Ventana del display                                     | Campos de texto, número y selección (`Input`, `Select`)                                 |

No se usa el logo ni la marca de Digitech: solo colores, materiales y vocabulario (por ejemplo, **Stop / Finish / Fade** para el modo de parada).

Los tokens viven en [`packages/renderer/src/styles/tokens.css`](../packages/renderer/src/styles/tokens.css) con prefijo `--jm-`. [`base.css`](../packages/renderer/src/styles/base.css) solo fija los valores por defecto de los elementos (box-sizing, márgenes, fuente heredada en controles) y ajusta los toasts de react-toastify a los tokens. La app ya no usa Bootstrap. Los componentes base están en [`packages/renderer/src/ui/`](../packages/renderer/src/ui/). Ningún componente de pantalla define colores, sombras ni radios propios: usa tokens o un componente de `ui/`.

El mockup de referencia es [`option-1b.html`](option-1b.html).

---

## 1. Color

### Chasis

| Token                   | Valor     | Uso                                |
| ----------------------- | --------- | ---------------------------------- |
| `--jm-blue`             | `#1f3d93` | Fondo base (azul del chasis)       |
| `--jm-blue-sheen`       | `#2546a3` | Parte alta del degradado del fondo |
| `--jm-blue-deep`        | `#1a3584` | Parte baja del degradado del fondo |
| `--jm-blue-plate`       | `#23449f` | Cara de una placa (patch)          |
| `--jm-blue-plate-hi`    | `#2a4fb0` | Brillo superior de la placa, hover |
| `--jm-blue-plate-hover` | `#3157bb` | Brillo superior en hover           |
| `--jm-blue-hi`          | `#3058bd` | Aro alrededor del switch cromado   |
| `--jm-blue-lo`          | `#142a6c` | Sombra/borde de placas, huecos     |

### Panel de control

| Token                     | Valor                 | Uso                                                         |
| ------------------------- | --------------------- | ----------------------------------------------------------- |
| `--jm-panel`              | `#18191c`             | Fondo de los paneles negros                                 |
| `--jm-panel-raised`       | `#2e3036` → `#1c1d21` | Degradado de las teclas de goma                             |
| `--jm-panel-raised-hover` | `#383b42` → `#232529` | Tecla en hover                                              |
| `--jm-panel-line`         | `#33363d`             | Separadores dentro de un panel                              |
| `--jm-panel-strip`        | `#1f2024`             | Franja sobre el panel: fila de frase, opción elegida, hover |
| `--jm-panel-sunk`         | `#111214`             | Fondo de los avisos (`Notice`)                              |
| `--jm-panel-edge`         | `#050506`             | Borde y sombra de las teclas                                |

### Impresión (texto)

| Token                  | Valor     | Uso                                            |
| ---------------------- | --------- | ---------------------------------------------- |
| `--jm-legend`          | `#f1f3f6` | Texto principal (sobre azul y sobre negro)     |
| `--jm-legend-on-blue`  | `#b4c3ea` | Texto secundario sobre azul                    |
| `--jm-legend-on-panel` | `#8e939c` | Texto secundario sobre negro                   |
| `--jm-pill`            | `#e8ebf0` | Fondo de la pastilla; su texto es `--jm-panel` |

### Display y LEDs

| Token             | Valor     | Uso                                                              |
| ----------------- | --------- | ---------------------------------------------------------------- |
| `--jm-seg`        | `#b6f03c` | Segmento encendido, ondas                                        |
| `--jm-seg-off`    | `#1d2713` | Segmento apagado (fantasma visible)                              |
| `--jm-seg-window` | `#0b0d0a` | Fondo de la ventana del display                                  |
| `--jm-led-red`    | `#ff3434` | Selección, reverse, STORE, modo de parada                        |
| `--jm-led-green`  | `#8fe43c` | Loop, tarjeta cargada, interruptores encendidos                  |
| `--jm-led-yellow` | `#f3e12b` | Tempo (parpadea al BPM). También es el color del foco de teclado |
| `--jm-led-off`    | `#2b2d31` | Cualquier LED apagado                                            |

**Reglas**

- Rojo = "esto está marcado/elegido". Verde = "esto está activo/encendido". Amarillo = tiempo y foco de teclado. No se usan para decorar.
- No hay más colores. Errores y avisos usan rojo; confirmaciones usan verde.
- Contraste (WCAG): `--jm-legend` sobre `--jm-blue-plate` 7.9:1; `--jm-legend-on-blue` sobre `--jm-blue-plate` 5.0:1; `--jm-legend-on-panel` sobre `--jm-panel` 5.7:1; texto de pastilla 14.7:1. Todo pasa AA para texto normal.

## 2. Tipografía

Dos familias, incluidas en el paquete (`@fontsource`), sin cargar nada de internet. La CSP solo permite `font-src 'self'`.

| Token              | Familia                          | Uso                                                             |
| ------------------ | -------------------------------- | --------------------------------------------------------------- |
| `--jm-font-legend` | **Barlow Condensed** 500/600/700 | Leyendas, nombres de patch, títulos, números grandes, pastillas |
| `--jm-font-body`   | **Barlow** 400/500/600           | Texto descriptivo, rutas, ayuda                                 |

| Token               | Tamaño / interlineado | Peso                   | Ejemplo                           |
| ------------------- | --------------------- | ---------------------- | --------------------------------- |
| `--jm-text-display` | 30px / 1.05           | 700 condensed          | Nombre del patch enfocado, tempo  |
| `--jm-text-title`   | 22px / 1              | 700 condensed          | "JamMan Manager"                  |
| `--jm-text-name`    | 19px / 1.1            | 700 condensed          | Nombre del patch en la lista      |
| `--jm-text-body`    | 14px / 1.45           | 400                    | Texto general                     |
| `--jm-text-meta`    | 12.5px / 1.4          | 500                    | Ritmo, parada, cantidad de frases |
| `--jm-text-legend`  | 12px / 1              | 700 condensed, +0.04em | Leyendas serigrafiadas            |
| `--jm-text-pill`    | 11px / 1.2            | 600 condensed, +0.03em | Pastillas                         |

**Reglas**

- Mayúsculas **solo** en leyendas serigrafiadas (`Legend`, texto de `PanelKey`) mediante `text-transform`. El texto fuente siempre va en minúsculas normales (sentence case), así los lectores de pantalla y los tests leen "Load patches", no "LOAD PATCHES".
- Los números se alinean con `font-variant-numeric: tabular-nums`.
- Los nombres de patch se cortan con elipsis; nunca pasan a dos líneas en la lista.

## 3. Espaciado

Base de 4px.

| Token          | Valor |
| -------------- | ----- |
| `--jm-space-1` | 2px   |
| `--jm-space-2` | 4px   |
| `--jm-space-3` | 6px   |
| `--jm-space-4` | 8px   |
| `--jm-space-5` | 12px  |
| `--jm-space-6` | 16px  |
| `--jm-space-7` | 20px  |
| `--jm-space-8` | 24px  |
| `--jm-space-9` | 32px  |

Margen de la ventana: `--jm-space-6` a los lados del contenido. Entre placas de la lista: `--jm-space-4`. Dentro de un panel: `--jm-space-8`.

## 4. Radios

| Token                | Valor | Uso                                            |
| -------------------- | ----- | ---------------------------------------------- |
| `--jm-radius-window` | 3px   | Ventana del display, celdas del mapa           |
| `--jm-radius-led`    | 2px   | LED rectangular                                |
| `--jm-radius-key`    | 7px   | Tecla de goma                                  |
| `--jm-radius-plate`  | 8px   | Placa de patch                                 |
| `--jm-radius-panel`  | 10px  | Paneles negros                                 |
| `--jm-radius-pill`   | 999px | Pastilla, LED redondo, switch cromado, perilla |

Cada nivel de la jerarquía física tiene su radio. No se usa un radio único para todo.

## 5. Sombras y materiales

| Token                                                                      | Uso                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `--jm-shadow-panel`                                                        | Panel negro sobre el chasis: brillo interior de 1px y sombra azul profunda        |
| `--jm-shadow-plate`                                                        | Placa en relieve: brillo arriba, sombra abajo y 3px de "altura" en `--jm-blue-lo` |
| `--jm-shadow-key`                                                          | Tecla de goma levantada (2px de altura)                                           |
| `--jm-shadow-key-pressed`                                                  | Tecla hundida (sombra interior, sin altura)                                       |
| `--jm-shadow-window`                                                       | Ventana del display hundida en el panel                                           |
| `--jm-shadow-stomp`                                                        | Switch cromado con su aro                                                         |
| `--jm-glow-red` / `--jm-glow-green` / `--jm-glow-yellow` / `--jm-glow-seg` | Halo de un LED o segmento encendido                                               |

Las sombras describen altura física (tecla, placa, panel), no "elevación de card". No hay sombras grises genéricas.

El fondo del chasis lleva un brillo metálico de puntos finos (`--jm-chassis-bg`). Solo se usa en el fondo de la app.

## 6. Estados

| Componente            | Reposo                                                                   | Hover                               | Activo / presionado                                                     | Deshabilitado                                   | Foco teclado                                 |
| --------------------- | ------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| `PanelKey`            | Degradado `--jm-panel-raised`, 2px de altura                             | Degradado `--jm-panel-raised-hover` | Baja 2px, `--jm-shadow-key-pressed` (también con `aria-pressed="true"`) | Opacidad 0.4, sin moverse, cursor `not-allowed` | Contorno 2px `--jm-led-yellow`, separado 2px |
| `PanelKey` con LED    | LED rojo encendido en la esquina: marca la acción principal (como STORE) | —                                   | —                                                                       | LED apagado                                     | Igual                                        |
| Placa de patch        | Degradado azul de placa                                                  | Brillo `--jm-blue-plate-hover`      | —                                                                       | —                                               | Contorno amarillo en el botón interno        |
| Placa enfocada        | Borde 2px `--jm-legend`                                                  | Igual                               | —                                                                       | —                                               | Igual                                        |
| Placa seleccionada    | LED rojo redondo encendido                                               | —                                   | —                                                                       | —                                               | —                                            |
| Slot vacío            | Sin placa: borde punteado, display al 50%                                | Borde visible                       | —                                                                       | —                                               | Igual                                        |
| `StompButton`         | Cromo                                                                    | Cromo más claro                     | Escala 0.94                                                             | Opacidad 0.4                                    | Igual                                        |
| `StompButton` sonando | Aro verde `--jm-led-green`                                               | —                                   | —                                                                       | —                                               | —                                            |
| `Led`                 | `--jm-led-off` con borde negro                                           | —                                   | Color y halo del LED                                                    | —                                               | —                                            |
| `Pill`                | `--jm-pill`                                                              | —                                   | —                                                                       | Opacidad 0.35 (opción no elegida)               | —                                            |
| `ModeKeys` (pestaña)  | Tecla levantada, LED apagado                                             | Igual que `PanelKey`                | Pestaña activa: tecla hundida (`aria-selected`) y LED encendido         | —                                               | Igual que `PanelKey`                         |
| `Input` / `Select`    | Ventana hundida `--jm-seg-window`; números en verde de display           | —                                   | Cursor de texto verde `--jm-seg`                                        | Texto `--jm-legend-on-panel`                    | Contorno amarillo                            |
| `ChoiceGroup`         | Opción con borde de 1px `--jm-panel-line` y LED apagado                  | Fondo `#1f2024`                     | Elegida: LED encendido y borde `--jm-legend-on-panel`                   | Opacidad 0.4                                    | Contorno amarillo en la opción               |
| `Notice`              | Borde de 1px del color de su LED (amarillo aviso, rojo error, verde ok)  | —                                   | —                                                                       | —                                               | —                                            |
| Placa arrastrada      | —                                                                        | —                                   | Borde `--jm-legend` y sombra más larga: la placa se levanta             | —                                               | Contorno amarillo                            |

## 7. Movimiento

- La tecla baja 2px en 60ms al presionarla. Es la única transición de botones.
- Un diálogo sube 8px y aparece en 140ms al abrirse; el fondo se oscurece con el azul del chasis.
- Al arrastrar, la placa se levanta (sombra más larga) y las demás se corren; lo maneja dnd-kit.
- El LED amarillo de tempo parpadea al BPM del patch enfocado (`60 / bpm` segundos).
- Nada más se mueve por sí solo. Con `prefers-reduced-motion: reduce` el LED queda fijo, las teclas no tienen transición y los diálogos aparecen sin moverse.

## 8. Componentes base (`src/ui`)

| Componente         | Props clave                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Panel`            | `screws?`, `as?`, `className`                                                                                                                           |
| `PanelKey`         | `label`, `hint?` (pastilla), `led?`, `tone?: 'danger'`, `size?: 'sm'`, botón nativo                                                                     |
| `MenuKey`          | `PanelKey` con un menú (`items`)                                                                                                                        |
| `Dialog`           | `isOpen`, `onClose`, `onClosed?`, `title`, `subtitle?`, `size?`, `footer?`, `dismissible?`. Usa `<dialog>` nativo: foco atrapado, Escape y fondo inerte |
| `ModeKeys`         | Pestañas como teclas (`label`, `idPrefix`, `value`, `options`); paneles con `modePanelId`                                                               |
| `Field`            | `label`, `htmlFor`, `hint?` (id `${htmlFor}-hint`)                                                                                                      |
| `Input` / `Select` | Controles nativos con el aspecto de la ventana del display                                                                                              |
| `ChoiceGroup`      | Radios nativos dibujados como LED + leyenda (`legend`, `name`, `value`, `options`, `led?`)                                                              |
| `LedToggle`        | Interruptor on/off con LED verde (`pressed`, `onChange`)                                                                                                |
| `Notice`           | `tone?: 'info' \| 'success' \| 'warning' \| 'danger'`, `title?`                                                                                         |
| `Well`             | Lista hundida con scroll para nombres                                                                                                                   |
| `Plate`            | Placa azul: `focused?`, `lifted?`, `as?`, `ref`                                                                                                         |
| `Grip`             | Seis puntos que marcan algo arrastrable                                                                                                                 |
| `Pill`             | `muted?`                                                                                                                                                |
| `Legend`           | `tone?: 'default' \| 'muted'`                                                                                                                           |
| `Led`              | `color: 'red' \| 'green' \| 'yellow'`, `on`, `shape?: 'square' \| 'round'`, `blink?` (segundos)                                                         |
| `SevenSegment`     | `value` (dígitos, `-` y espacio), `height`                                                                                                              |
| `DisplayWindow`    | Ventana hundida para `SevenSegment`                                                                                                                     |
| `StompButton`      | `active?`, `label` (nombre accesible), botón nativo                                                                                                     |
| `Knob`             | `index`, `count`, `label`                                                                                                                               |

## 9. Texto

- Sentence case en todo el texto fuente; las mayúsculas solo vienen del CSS de las leyendas.
- Las acciones dicen lo que hacen: "Load patches", "New patch", "Edit patch", "Delete", "Store patch", "Apply order".
- Los avisos dicen qué pasa y cómo volver atrás ("Undo brings them back while this card stays open"), sin disculpas ni "Are you sure?".
- El modo de parada usa las palabras del pedal: **Stop** (se detiene al instante), **Finish** (termina el loop) y **Fade** (se desvanece), siempre con una frase que lo explica.
- Las pastillas muestran el atajo (`⌘O`, `⌘Z`) o la segunda función (`TXT / PDF`, `Restore`). Son informativas: el nombre accesible del botón es su `label`.

## 10. Pantallas

- **Principal**: cabecera, mapa de memoria, lista de patches, panel de detalle, estados vacío/cargando y reproductor.
- **Diálogos** (`Dialog`): crear/editar patch, borrar, backup y restore, playlists. Todos tienen el mismo pie: Cancel a la izquierda y la acción principal al final con su LED encendido; borrar usa `tone="danger"` en lugar del LED.
- **Ordenar**: pantalla completa sobre el chasis. Cada placa muestra en el display el slot que recibirá al aplicar (la app renumera desde Patch01) y una pastilla "was NN" si se movió.

Los errores de validación y las confirmaciones van dentro del panel (`Notice`), no en `alert()` ni `confirm()` del sistema.
