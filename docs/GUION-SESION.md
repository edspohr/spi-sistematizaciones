# Guion de la sesión de mapeo — InvimÁgil (Microsoft Edge, Windows 11)

Este guion se escribe para **Microsoft Edge en Windows 11 sin permisos de
administrador**. La analista trabaja sola, sobre un **borrador de sistematización
de una consulta existente** creado con un usuario de prueba. **Nunca se envía**
el trámite.

Nada de lo que hace el mapper viaja a Internet. Todo se guarda en
`localStorage` del propio navegador y en el archivo JSON que se descarga al
final de la sesión.

> Si por algún motivo se usara Chrome, la ruta es la misma pero los menús
> están en inglés: **Sources → Snippets** en vez de **Orígenes → Fragmentos**.

---

## 0. Antes de empezar

- Iniciar sesión en InvimÁgil como siempre. El mapper **no** maneja usuarios
  ni contraseñas.
- Entrar al **borrador de sistematización** creado con el usuario de prueba
  (no un expediente real). Confirmar que aparece la primera pantalla
  (`sistematizacion`).
- Tener a mano el archivo `tools/mapper.js`. Se abre con el Bloc de notas
  para copiar su contenido.

---

## 1. Cargar el mapper (una sola vez por sesión)

**Ruta recomendada — Fragmentos de código de Edge DevTools:**

1. Presionar **F12** para abrir DevTools.
2. Ir a la pestaña **Orígenes** (equivalente a *Sources*).
   - Si no la ve arriba, hacer clic en el **`»`** de desbordamiento y
     seleccionar *Orígenes*.
3. En el panel lateral izquierdo hay tres subpaneles: **Página**,
   **Sistema de archivos** y **Fragmentos de código** (*Snippets*).
   - Si **Fragmentos de código** no está visible, abrirlo también desde el
     **`»`** dentro del panel lateral.
4. Clic derecho en **Fragmentos de código → Nuevo fragmento**. Nombrarlo
   `invimagil-mapper`.
5. Abrir `tools/mapper.js` en el Bloc de notas, seleccionar todo (Ctrl+A),
   copiar (Ctrl+C).
6. Pegar en el fragmento (Ctrl+V). Si Edge pide permiso, ir a la pestaña
   **Consola** y escribir literalmente **`allow pasting`** + Enter, luego
   volver al fragmento y pegar.
7. Presionar **Ctrl+Enter** para ejecutar el fragmento (también sirve el
   botón ▶ arriba a la derecha del editor de fragmentos).
8. Abajo a la derecha aparece un panel titulado **InvimÁgil — Mapeo**.

**Ruta fallback — bookmarklet:**

- Abrir `tools/mapper.bookmarklet.txt`, copiar toda la línea, crear un
  favorito nuevo en Edge y pegarla como URL.
- Hacer clic en el favorito estando en la página de InvimÁgil.
- **Advertencia:** muchas plataformas empresariales bloquean los
  bookmarklets vía Content-Security-Policy. Si no aparece el panel,
  usar la ruta de Fragmentos.

**Después de una navegación:** InvimÁgil es un SPA. El mapper detecta
cambios y los registra como eventos de navegación (informativos). Si el
panel desaparece, volver a *Orígenes → Fragmentos → invimagil-mapper*,
clic derecho → **Ejecutar** (o Ctrl+Enter). El estado se restaura solo
desde `localStorage`; **no se pierde nada** de lo mapeado antes.

---

## 2. Secuencia de pantallas del trámite de sistematización

El mapper viene precargado con la secuencia esperada. Los ids son los que
usaremos para amarrar cada campo a su pantalla:

| Orden | Id                | Nombre en pantalla    |
|------:|-------------------|-----------------------|
|     1 | `sistematizacion` | Sistematización       |
|     2 | `responsables`    | Responsables          |
|     3 | `producto`        | Producto              |
|     4 | `presentacion`    | Presentación          |
|     5 | `formula`         | Fórmula               |
|     6 | `instrucciones`   | Instrucciones         |
|     7 | `organolepticas`  | Organolépticas        |
|     8 | `fisicoquimicos`  | Fisicoquímicos        |
|     9 | `adjuntos`        | Adjuntos              |
|    10 | `revision`        | Revisión              |

En el panel, la tira superior muestra el estado de cada una:

- gris → **pendiente**
- azul claro → **marcada**
- verde → **con snapshot**
- azul oscuro con número → **N campos mapeados**
- borde naranja → **pantalla actual**

Si InvimÁgil tiene una pantalla que no está en la lista, usar el desplegable
opción **«otra…»** y escribir un nombre. Se normaliza automáticamente
(minúsculas, sin tildes, espacios como `_`).

---

## 3. Regla de oro por pantalla

**Una pantalla a la vez:**

1. **Marcar** la pantalla (desplegable → botón «Marcar pantalla»).
2. **Guardar snapshot** de la pantalla completa (queda sanitizado por
   defecto — no incluye valores).
3. **Mapear todos los campos visibles** antes de avanzar. Los campos que
   ya vienen en el esquema tienen su botón «Mapear»; los que no aparecen se
   agregan con **＋ Campo nuevo**.
4. **Avanzar** a la siguiente pantalla en InvimÁgil y repetir.

Marcar una pantalla que ya se marcó no borra nada: el mapper solo actualiza
la última marca. Las capturas y snapshots previos se conservan.

---

## 4. Prueba de inyección — hacer primero, una sola vez

**Solo sobre este borrador de prueba**, en un campo de texto cualquiera
(ideal: un campo del que se pueda restaurar el valor original).

- Botón **Probar inyección** → confirmar la advertencia.
- Si el mapper detecta un campo de búsqueda, ofrece usarlo. Aceptar si aplica.
- Si no, entrar en modo captura y **clic en el campo de texto objetivo**.
- El mapper escribe un valor de prueba, verifica y **restaura el original**.
  Lee el resultado:
  - **«El valor se mantuvo. Combinación efectiva: …»** — la estrategia
    funciona; la extensión podrá llenar campos.
  - **«El valor fue revertido por la plataforma»** — la estrategia estándar
    no basta; cambiaremos de enfoque (Playwright). Es información valiosa,
    conviene saberlo hoy.
  - **«[ATENCIÓN] No se pudo confirmar la restauración»** — revisar el
    campo manualmente antes de seguir.

---

## 5. Mapear los campos de cada pantalla

- Sección **Campos del esquema** — cada fila tiene botón **Mapear**.
- Clic en **Mapear** → clic en el control correspondiente del formulario.
- Para cancelar la captura: **Escape**.
- Para campos que no aparecen en el esquema: botón **＋ Campo nuevo** al
  final. El flujo es:
  1. Clic en el elemento en la página.
  2. El mapper propone un nombre a partir de la etiqueta visible (ya
     normalizado). Aceptar o corregir.
  3. Propone la sección con el id de la pantalla actual. Aceptar o cambiar.
- Todo se guarda solo al capturar. No hace falta guardar a mano.

---

## 6. Sonda del combobox de INCI (pantalla «formula»)

En la sección Fórmula, el mapper ofrece cuatro casos. **Ejecutar los
cuatro**, presionando «Detener sonda» entre uno y otro:

| Caso   | Qué hacer                                                       |
|--------|-----------------------------------------------------------------|
| caso1  | INCI corto con muchas opciones — escribir `Aqua`, elegir uno.  |
| caso2  | INCI largo exacto — escribir un INCI completo, elegir el match.|
| caso3  | INCI inexistente — escribir algo que no existe, ver la respuesta. |
| caso4  | Crear una mezcla — abrir el flujo de mezcla y completarlo.     |

Cada caso queda etiquetado en el JSON. Si el mismo caso se repite, se
guarda una entrada nueva; nada se sobrescribe.

---

## 7. Cierre de la sesión — exportar siempre

**Exportar al final de cada sesión, incluso si quedó incompleta.**

1. Botón **Descargar JSON**. Antes de guardar, el panel muestra un
   **resumen** con:
   - pantallas marcadas y pendientes,
   - campos mapeados por pantalla,
   - resultado de la última prueba de inyección,
   - casos de sonda hechos y pendientes.
2. Confirmar la descarga. El archivo se llama
   `mapeo-invimagil-<primera-pantalla>-YYYYMMDD-HHmm.json`.
3. Si la descarga está bloqueada por política, el mapper ofrece **Copiar al
   portapapeles**; pegar en un archivo de texto y enviarlo por el canal
   acordado.
4. Enviar el JSON según la instrucción de `LEEME.txt`.

Opcional: si prefiere no dejar nada en la máquina, botón **Borrar todo**
en el panel. Solo hágalo **después** de exportar.

---

## Problemas comunes

- **«El panel no aparece.»** ¿Ejecutó el fragmento con Ctrl+Enter?
  ¿La página terminó de cargar antes de pegar? Recargar y reintentar.
- **«Edge pide `allow pasting`.»** Escribir esas dos palabras en la
  Consola y volver a pegar. Es una protección contra ingeniería social.
- **«El desplegable de pantallas está vacío.»** No debería —
  vienen precargadas. Si pasa, recargar la página y volver a ejecutar el
  fragmento (el estado se conserva).
- **«Modo captura no reacciona.»** Puede haber un modal encima. Presionar
  Escape, cerrar el modal, reintentar.
- **«La descarga no aparece.»** La política del navegador puede bloquearla.
  Usar **Copiar al portapapeles**.
- **«Perdí una captura.»** El mapper guarda tras cada acción. Revisar la
  sección de errores en el panel (botón **Ver errores**).

---

## Qué NO hace el mapper

- No envía nada a Internet.
- No maneja usuario ni contraseña.
- No hace clic en Enviar / Radicar / Firmar / Confirmar / Pagar.
- No modifica registros reales — la prueba de inyección restaura el valor.
- No captura datos del cliente en los snapshots (a menos que se desactive
  explícitamente la sanitización).
