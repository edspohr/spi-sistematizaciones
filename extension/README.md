# InvimÁgil Inyector — extensión MV3 para Chrome / Edge

Llena el trámite de NSO en InvimÁgil con la planilla aprobada en **SPI Sistematización**
(https://spi-sistematizaciones.web.app). Desde el borrador en «Sistematización», **Llenar todo hasta
Términos** llena cada pantalla, verifica, carga los documentos preparados por la app y pulsa
«Siguiente», hasta Términos y condiciones. Ahí se detiene: aceptar y radicar es de la analista.
Las mezclas se crean aparte, en Administración de Ingredientes → Mezclas («Crear las mezclas»).
Guía para la analista: `docs/GUIA-INYECTOR.md` (va en el paquete como `LEEME.md`).

Estado: **v0.3.0**. Recorrido completo, documentos, mezclas, validaciones y fechas probados contra la
réplica `tools/mock-invimagil-flujo.html` con la planilla real de Producto 1. Contra InvimÁgil real solo
están confirmadas Sistematización y Términos. La plataforma solo acepta conexiones desde Colombia, así
que la primera corrida (borrador de prueba) la hace SPI allá. Cada pantalla recorrida deja una captura
(controles + llamadas GraphQL de la plataforma) en `capturas` para ajustar el mapa.

Cómo encuentra cada control, en orden:

1. Por `id`, también con el prefijo de formulario de Ant Design (`form_campo`).
2. Por etiqueta exacta.
3. Por `alias`.
4. Por aria-label o placeholder.
5. Por etiqueta aproximada: todas las palabras de la etiqueta aparecen en una única etiqueta de la
   pantalla. Este caso queda marcado para revisión.

Las fechas se escriben con el formato que indique el placeholder del selector.

## Cómo se conecta con la app

Sin claves ni inicio de sesión propio. `content/puente.js` corre en la app y habla con ella por
`window.postMessage`; la app escribe en Firestore con la sesión de la analista.

| Dirección | Mensaje | Qué pasa |
|---|---|---|
| app → extensión | `enviar` | la planilla del trámite queda en `chrome.storage.local.tramites` |
| extensión → app | `salida` | verificaciones (`tramites/{id}/inyecciones`) y capturas (`capturas`) |
| app → extensión | `ack` | la extensión borra de su cola lo ya guardado |

Si la app no está abierta, los resultados esperan en la extensión y se entregan la próxima vez.
También sigue funcionando con una carpeta local (`_invimagil/planilla.json` de InvimÁgil Base).

## Piezas

| Archivo | Qué hace |
|---|---|
| `manifest.json` | MV3. Solo InvimÁgil y la app. Las entradas `localhost` son para pruebas y `tools/build-extension.sh` las quita. |
| `panel/` | Panel lateral: trámite recibido, recorrido automático (`autopiloto.js`, sin APIs de Chrome para poder probarlo en la réplica), una pantalla a la vez, mezclas, verificación, captura. Entrega los PDF preparados al contenido (`PEDIR_DOCUMENTO`). |
| `background.js` | Guarda los trámites recibidos y la cola de resultados. |
| `content/puente.js` | Puente con la app (solo en el dominio de la app). |
| `content/engine.js` | Primitivas Ant Design: texto, switch, radio, fecha, select con **coincidencia exacta** y orden de preferencia, modales, archivos. Lista negra de botones (Finalizar, Enviar, Radicar…); «Siguiente» solo por `E.next()`, que usa el recorrido. |
| `content/filler.js` | Recorre `mapa-formulario.json` para la pantalla actual; tablas = un modal por fila; captura de controles para mapeo. |
| `main/apollo-reader.js` | Mundo MAIN, desde `document_start`, **solo lectura**: devuelve `request.content` desde la caché Apollo y registra las operaciones GraphQL que hace la página (nombre, consulta, variables, inicio de la respuesta; nunca cabeceras). |
| `mapa-formulario.json` | Pantalla → campos → control (`id`, luego `selector`, luego texto de `label`). |

## Instalar

```bash
tools/build-extension.sh
```

Chrome o Edge → `chrome://extensions` → «Modo de desarrollador» → «Cargar descomprimida» →
`dist/InvimagilInyector-<versión>`. Para SPI: subir el `.zip` como publicación **no listada** en
Chrome Web Store (aprobado 2026-10-15).

## Pendiente para producción

- Confirmar en vivo los controles de Inicio, Información General, Composición, Información de Uso,
  Características Técnicas y Documentos (modo captura) y ajustar `mapa-formulario.json`.
- Mezclas (Administración de Ingredientes): la Circular 1000-014-2026 exige crearlas antes de
  Composición; falta mapear esa pantalla y decidir si la planilla las trae.
- Formato de fecha que espera el selector de fechas real (la app guarda `AAAA-MM-DD`).
- Adjuntar documentos desde Cloud Storage en las pantallas de documentos.

## Probar en local

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Abrir `http://localhost:8765/tools/mock-antd.html`, cargar `extension/content/engine.js` en la
consola y ejercitar `window.__inyector` (ver el script de prueba en el historial del repo /
`tools/SMOKETEST.md`). La réplica incluye un INCI remoto con listados distintos por ingrediente
para comprobar UE > PCPC > FDA, y un botón «Siguiente» que debe quedar bloqueado.

## Reglas que no se negocian (están en código)

- Nunca pulsa Siguiente, Anterior, Guardar y enviar, Finalizar, Radicar, Enviar, Eliminar ni marca Términos.
- Solo coincidencia exacta (sin tildes ni mayúsculas). Sin coincidencia → campo vacío y reportado.
- Solo actúa si el Id de la URL coincide con el confirmado en el panel y el encabezado coincide con la pantalla.
- Modal a medias → Cancelar. Nunca guarda una fila incompleta.
- Solo habla con InvimÁgil y con la app de SPI: ni claves ni telemetría.
