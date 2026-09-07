# Checklist — sesión de mapeo InvimÁgil

Página imprimible para tener al lado durante la sesión. Cada casilla es un
paso; marque a medida que avanza. Detalle completo en `GUION-SESION.md`.

**Navegador:** Microsoft Edge en Windows 11 · **Usuario:** de prueba
**Trámite:** borrador de sistematización — **nunca** enviar.

---

## Preparación

- [ ] Sesión iniciada en InvimÁgil.
- [ ] Borrador de sistematización de prueba abierto.
- [ ] Archivo `tools/mapper.js` a la mano en el Bloc de notas.

## Cargar el mapper

- [ ] F12 → **Orígenes** (usar `»` si no aparece).
- [ ] Panel **Fragmentos de código** visible (usar `»` si hace falta).
- [ ] Clic derecho → **Nuevo fragmento** → nombre `invimagil-mapper`.
- [ ] Pegar todo el contenido de `mapper.js` (Ctrl+V; si Edge lo bloquea:
      Consola → escribir `allow pasting` → Enter → volver a pegar).
- [ ] **Ctrl+Enter** → panel «InvimÁgil — Mapeo» abajo a la derecha.

## Prueba de inyección (una sola vez)

- [ ] Botón **Probar inyección** → confirmar.
- [ ] Aceptar campo de búsqueda si el mapper lo detecta, o hacer clic en
      un campo de texto del borrador.
- [ ] Anotar el resultado (mantenido / revertido / atención).

## Por cada pantalla (una a la vez)

Repetir para cada una de las 10 pantallas:

`sistematizacion` · `responsables` · `producto` · `presentacion` ·
`formula` · `instrucciones` · `organolepticas` · `fisicoquimicos` ·
`adjuntos` · `revision`

- [ ] Elegir la pantalla en el desplegable → **Marcar pantalla**.
- [ ] **Guardar snapshot**.
- [ ] **Mapear** cada campo visible del esquema.
- [ ] **＋ Campo nuevo** para lo que no aparezca en el esquema.
- [ ] Avanzar a la siguiente pantalla en InvimÁgil.

Progreso visible en la tira superior del panel: gris = pendiente,
azul claro = marcada, verde = con snapshot, azul oscuro con número =
N campos mapeados, borde naranja = pantalla actual.

## Sonda del combobox (solo pantalla `formula`)

Ejecute cada caso y presione **Detener sonda** entre uno y otro:

- [ ] **caso1** — INCI corto con muchas opciones (ej. `Aqua`).
- [ ] **caso2** — INCI largo exacto.
- [ ] **caso3** — INCI inexistente.
- [ ] **caso4** — Crear una mezcla.

## Cierre

- [ ] **Descargar JSON** → revisar el resumen en pantalla → confirmar.
- [ ] Archivo `mapeo-invimagil-<pantalla>-YYYYMMDD-HHmm.json` guardado.
- [ ] Si la descarga falla → **Copiar al portapapeles** → pegar en un `.txt`.
- [ ] Enviar el archivo por el canal indicado en `LEEME.txt`.
- [ ] (Opcional) **Borrar todo** en el panel si no quiere dejar nada en
      la máquina — solo **después** de exportar.

---

**Regla general:** ante cualquier duda, **exportar** y contarle al equipo.
Es preferible un JSON incompleto a perder el trabajo de la sesión.
