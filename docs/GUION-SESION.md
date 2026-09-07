# Guion de la sesión de mapeo — InvimÁgil

Este guion describe el orden exacto en que se debe ejecutar la sesión con la analista.
El objetivo es capturar todo lo necesario para diseñar el llenado asistido **sin
volver a molestarla** para una segunda sesión.

Nada de lo que hace este mapper se envía a Internet. Todo queda en `localStorage`
del navegador y en el JSON que se descarga al final.

---

## 0. Antes de empezar

- Abrir el sitio InvimÁgil en Chrome y **iniciar sesión como siempre**.
  El mapper NO maneja usuarios ni contraseñas.
- Tener a mano el archivo `tools/mapper.js`.

---

## 1. Cargar el mapper (una sola vez)

**Camino recomendado — DevTools Snippet**:

1. Presionar `F12` para abrir DevTools.
2. Ir a la pestaña **Sources** (Fuentes) → panel **Snippets**.
   - Si el panel Snippets no aparece, hacer clic en el `»` para expandirlo.
3. Clic derecho en **Snippets** → **New snippet** → nombrarlo `invimagil-mapper`.
4. Si Chrome pide autorización al pegar, escribir literalmente **`allow pasting`**
   en la pestaña **Console** y presionar Enter.
5. Pegar todo el contenido de `tools/mapper.js` en el snippet.
6. Presionar **Ctrl+Enter** (o el botón ▶) para ejecutarlo.
7. Aparece un panel abajo a la derecha titulado **InvimÁgil — Mapeo**.

**Camino fallback — bookmarklet** (usar solo si el panel Sources está bloqueado
por política):

- Abrir `tools/mapper.bookmarklet.txt`, copiar toda la línea, crear un
  marcador nuevo en Chrome y pegarla como URL.
- Hacer clic en el marcador mientras se esté en la página de InvimÁgil.
- **Advertencia:** muchas plataformas empresariales bloquean los bookmarklets
  con Content-Security-Policy. Si no aparece el panel, use el Snippet.

**Después de una navegación** (la plataforma es un SPA, así que el mapper
detecta cambios de pantalla automáticamente): si el panel no reaparece,
volver a Sources → Snippets → clic derecho en `invimagil-mapper` → **Run**
(o Ctrl+Enter). El estado se restaura desde `localStorage` — no se pierde nada.

---

## 2. Marcar la pantalla actual

- Botón **Marcar pantalla** en la sección "Pantalla y flujo". Aceptar el
  nombre sugerido o escribir uno mejor (ej. `identificacion`, `formula`,
  `revision_final`).
- Botón **Guardar snapshot**. Deja un HTML sanitizado de la pantalla en
  `localStorage` para que podamos reconstruir selectores fuera de línea.
  El indicador dice **Sanitizado: sí** por defecto — mantener así salvo
  que sea absolutamente necesario un snapshot completo.

---

## 3. Prueba de inyección (crítica — hacer primero)

**Esta prueba solo debe correrse sobre un borrador NUEVO o sobre un campo
de búsqueda/filtro.** InvimÁgil autoguarda al modificar campos: escribir
en un registro real podría dejar datos de prueba en el expediente del cliente.

- Si hay un registro borrador, abrirlo. Si no, ir a la lista y ejecutar la
  prueba sobre el buscador.
- Botón **Probar inyección** → confirmar la advertencia.
- Si el mapper detecta un campo de búsqueda en la página, ofrecerá usarlo
  directamente. Aceptar si aplica.
- Si no, entrar en modo captura y **hacer clic en el campo de texto objetivo**.
- El mapper escribe, verifica y **restaura el valor original**. Al final avisa:
  - `El valor se mantuvo. Combinación efectiva: …` — vamos bien, la extensión
    funcionará.
  - `El valor fue revertido por la plataforma` — cambiamos de enfoque
    (Playwright), necesitamos saberlo hoy.
  - Si dice `[ATENCIÓN] No se pudo confirmar la restauración`, **revisar el
    campo manualmente** antes de seguir.

---

## 4. Mapear los campos de la pantalla

- La sección **Campos del esquema** lista los campos conocidos, agrupados por
  sección. Cada fila muestra `mapeado` / `sin mapear` y un botón **Mapear**.
- Clic en **Mapear** → clic en el control correspondiente en el formulario.
- Si el campo no existe en el esquema (esto es esperable, el esquema es semilla):
  botón **＋ Campo nuevo** al final de la lista. Capturar el elemento primero,
  luego el mapper pregunta el nombre y la sección.
- Cada captura se guarda automáticamente. No hace falta guardar manualmente.
- Para cancelar la captura: **Escape**.

---

## 5. Sonda del combobox de ingredientes (crítica — solo en la sección de fórmula)

- Ir a la pantalla donde se agregan ingredientes (Fórmula).
- Botón **Sondear autocompletado** → clic en el campo de búsqueda de INCI.
- **Escribir un INCI real como lo haría en la operación normal** (por ejemplo
  `Aqua`), esperar la lista, seleccionar una opción.
- Botón **Detener sonda**. El JSON de exportación contendrá todos los eventos,
  las mutaciones del DOM, los selectores de la lista y las opciones, y la
  latencia. Esto es lo que necesita el llenado automático para funcionar.

---

## 6. Repetir por cada pantalla

- Cada vez que la analista avance un paso: **Marcar pantalla**, snapshot, mapear
  los campos visibles. El mapper también detecta cambios automáticamente y los
  registra como `(auto) …` — mejor confirmar con nombres claros.

---

## 7. Cierre de la sesión

1. Botón **Descargar JSON**. Confirmar el aviso de contenido.
   - Nombre del archivo: `mapeo-invimagil-YYYYMMDD-HHmm.json`.
   - Si la descarga está bloqueada, el mapper ofrece **Copiar al portapapeles**;
     pegar en un archivo de texto o en el canal acordado.
2. Verificar que el archivo se abrió bien (contiene `mapeos`, `pantallas`,
   `pruebasInyeccion`, `sondaCombobox`, `snapshots`).
3. Opcional — si la analista prefiere no dejar nada en la máquina:
   **Borrar todo** en el panel. Esto limpia `localStorage`.
4. Cerrar el snippet no borra nada; cerrar el navegador tampoco.

---

## Problemas comunes

- **"El panel no aparece."** ¿Ejecutó el snippet con Ctrl+Enter? ¿La página
  cargó completamente antes de pegar? Recargar y volver a ejecutar.
- **"Chrome pide `allow pasting`."** Escribir esas dos palabras en la Console
  y volver a pegar. Es una protección contra ingeniería social.
- **"Modo captura no reacciona."** Puede que un modal de InvimÁgil esté capturando
  clics. Presionar Escape, cerrar el modal, reintentar.
- **"El sitio se ve raro cuando el panel está abierto."** El panel está en
  Shadow DOM, no debería afectar la página. Arrastrarlo por la cabecera o
  minimizar con ▁ si estorba.
- **"La descarga no aparece."** La política del navegador puede bloquearla.
  Usar **Copiar al portapapeles**.
- **"Perdí una captura."** Muy raramente pasa: el mapper guarda después de
  cada captura. Revisar la sección de errores en el panel
  (botón **Ver errores**).

---

## Qué NO hace el mapper

- No envía nada a Internet.
- No maneja usuario ni contraseña.
- No hace clic en Enviar / Radicar / Firmar / Confirmar / Pagar.
- No modifica registros reales — la prueba de inyección restaura el valor.
- No captura datos del cliente en los snapshots (a menos que la analista
  desactive explícitamente la sanitización).
