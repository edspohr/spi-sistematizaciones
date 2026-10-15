# InvimÁgil Inyector (Slice 3) — extensión MV3 para Chrome / Edge

Llena cada pantalla del trámite de NSO en InvimÁgil desde `_invimagil/planilla.json`
(generado por InvimÁgil Base). La analista elige la carpeta, pulsa «Llenar esta pantalla»,
revisa la tabla de verificación y pulsa Siguiente ella misma.

Estado: **v0.1.0, núcleo probado solo contra la réplica local** (`tools/mock-antd.html`).
El mapa de controles (`mapa-formulario.json`) tiene los ids tomados de `request.content`;
los marcados `mapeado: false` deben confirmarse en vivo sobre un borrador de prueba.

## Piezas

| Archivo | Qué hace |
|---|---|
| `manifest.json` | MV3. Solo `https://invimagil.invima.gov.co/*`. Sin llamadas de red. |
| `panel/` | Panel lateral: carpeta del producto (File System Access), Id de solicitud, pantalla detectada, Llenar / Solo mostrar / Verificar, tabla de verificación, registro en `_invimagil/log-inyeccion.md`. |
| `content/engine.js` | Primitivas Ant Design: texto (setter nativo + eventos React), switch, radio Sí/No, fecha, select con **coincidencia exacta** y orden de preferencia, modales (abrir / guardar / cancelar), archivos por `input[type=file]`. Lista negra de botones (Siguiente, Finalizar, Enviar…). |
| `content/filler.js` | Recorre `mapa-formulario.json` para la pantalla actual; tablas = un modal por fila; aplica `listados_referencia_prioridad` de `planilla._meta.criterios`. |
| `main/apollo-reader.js` | Mundo MAIN, **solo lectura**: devuelve `request.content` desde la caché Apollo para verificar lo guardado. |
| `mapa-formulario.json` | Pantalla → campos → control (`id`, luego `selector`, luego texto de `label`). |

## Probar en local

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Abrir `http://localhost:8765/tools/mock-antd.html`, cargar `extension/content/engine.js` en la
consola y ejercitar `window.__inyector` (ver el script de prueba en el historial del repo /
`tools/SMOKETEST.md`). La réplica incluye un INCI remoto con listados distintos por ingrediente
para comprobar UE > PCPC > FDA, y un botón «Siguiente» que debe quedar bloqueado.

## Instalar para desarrollo (Chrome)

1. `chrome://extensions` → activar «Modo de desarrollador».
2. «Cargar descomprimida» → carpeta `extension/`.
3. Abrir el trámite en InvimÁgil, clic en el icono de la extensión → panel lateral.

Distribución a SPI: publicación **no listada** en Chrome Web Store (aprobado 2026-10-15).

## Reglas que no se negocian (están en código)

- Nunca pulsa Siguiente, Anterior, Guardar y enviar, Finalizar, Radicar, Enviar, Eliminar ni marca Términos.
- Solo coincidencia exacta (sin tildes ni mayúsculas). Sin coincidencia → campo vacío y reportado.
- Solo actúa si el Id de la URL coincide con el confirmado en el panel y el encabezado coincide con la pantalla.
- Modal a medias → Cancelar. Nunca guarda una fila incompleta.
- Nada sale del equipo: ni documentos, ni claves, ni telemetría.
