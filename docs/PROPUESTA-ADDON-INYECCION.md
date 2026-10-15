# Propuesta — Add-on de inyección de datos en InvimÁgil (Slice 3)

Fecha: 2026-10-15 · Autor: Edmundo Spohr (Growth Buddies) · Para: SPI Américas (Juliana Gallo, Laura Arévalo, Mauricio Cortés)

## 1. Qué se quiere lograr

Hoy el flujo es: carpeta del cliente → **InvimÁgil Base** genera el maestro (`_invimagil/planilla.json` + Excel) → Laura copia y pega campo a campo en InvimÁgil. El cuello de botella sigue siendo Composición: 30 a 40 ingredientes, cada uno con autocompletado, entre 40 minutos y 1,5 horas por producto (reunión 2026-10-15).

Objetivo del add-on: la analista abre el trámite en InvimÁgil, elige la carpeta del producto, y por cada pantalla pulsa **«Llenar esta pantalla»**. El add-on escribe todos los campos de esa pantalla, muestra una verificación campo a campo (lo que dice el maestro vs. lo que quedó en la plataforma), la analista revisa, corrige lo que haga falta y pulsa **Siguiente** ella misma. Nunca avanza ni envía solo.

Meta de tiempo: Composición en menos de 5 minutos con verificación incluida; producto completo en 15 a 20 minutos.

## 2. Lo que ya sabemos de la plataforma (base de la propuesta)

| Hecho | Fuente | Consecuencia para el diseño |
|---|---|---|
| InvimÁgil es una SPA React + Ant Design con Apollo (GraphQL). El estado del trámite es `request.content` y su estructura ya está capturada (`invimagil-mapeo-106983.json`, 2026-09-15). | Captura de la caché Apollo, sesión del 15-sep | La planilla ya es un espejo de `request.content`: el mapeo planilla → formulario es directo. Además se puede **verificar leyendo la caché**, no solo el DOM. |
| El `id` de cada control es igual al nombre del campo (`nsoNumber`, `wantsToSystematize`, `issueDate`…). | `harvestDom` de la misma captura | Selectores estables; no dependemos de clases CSS. |
| La inyección por valor nativo + eventos funciona: texto y listas se mantienen, sin reversión. | Sonda en vivo con Laura, 2026-08-24 | No hace falta Playwright ni control remoto. |
| Las listas (selects y autocompletado de INCI) solo toman el dato si se **despliega y se hace clic en la opción**; escribir el texto no basta. | Laura, 2026-10-15; prompt Fase B | El add-on simula la interacción completa: abrir, filtrar, esperar opciones, elegir **solo la coincidencia exacta**. |
| Pasos del asistente: Sistematización · Inicio (17 preguntas Sí/No) · Información General · Composición · Información de Uso · Características Técnicas · Documentos soporte · Documentos complementarios · Términos y condiciones. Presentaciones, ingredientes y parámetros se agregan por modal «+ Agregar». | Prompt Fase B, harvest | El add-on trabaja **por pantalla** y, dentro de ella, **por fila de modal**. |
| Un error en el trámite cuesta 15 días hábiles; la plataforma exige usuario y contraseña por cliente. | Reuniones 12-ago y 15-oct | Humano en el circuito en cada pantalla; nada de bot nocturno; el add-on usa la sesión ya abierta y no toca credenciales. |
| Laura trabaja en **Microsoft Edge, Windows 11, sin permisos de administrador**. | Guion de sesión | La distribución debe funcionar sin admin: Edge acepta extensiones de Chrome. |
| Prioridad del listado de referencia: **Unión Europea > PCPC > FDA**, según lo que la plataforma ofrezca para cada ingrediente. | Laura, 2026-10-15 | Esta regla vive en el add-on (solo en pantalla se sabe qué listados ofrece cada INCI) y como preferencia por defecto en el extractor. |

## 3. Alternativas evaluadas

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **A. Extensión de navegador (MV3) para Edge/Chrome** | Corre dentro de la sesión de la analista; sin credenciales; UI propia (panel lateral); acceso a la carpeta local vía File System Access; determinista y sin red; instalable sin admin. | Hay que mantener el mapa de controles si INVIMA cambia el formulario; distribución requiere cuenta de desarrollador o modo desarrollador. | **Recomendada.** |
| B. Agente de IA en el navegador (como la demo del 15-sep) | Cero código de mapeo; se adapta a cambios de pantalla. | Lento (minutos por pantalla), costo por campo, no determinista, requiere la app de Claude abierta; descartado por SPI el 15-sep. | Útil para descubrir el formulario; no para producción. |
| C. Script de automatización externo (Playwright / Selenium) | Control total del navegador. | Abre otro navegador, hay que manejar login y 2FA, se parece a un bot, se nota distinto a un uso humano. | Solo como plan B si la inyección desde extensión fallara. |
| D. Bookmarklet o fragmento de DevTools (como el mapper) | Sin instalación. | CSP puede bloquearlo, sin acceso a archivos, UX frágil, se pierde al navegar. | Solo para emergencias y diagnóstico. |
| E. Escribir directo a la API GraphQL / caché Apollo | Rápido y exacto. | Usa una API interna no documentada, salta las validaciones del formulario, podría interpretarse como uso indebido de la plataforma. | **Descartado para escribir.** Se usa **solo para leer** y verificar. |

## 4. Diseño propuesto

### 4.1 Piezas

```
Carpeta del producto/
  _invimagil/planilla.json      ← fuente de verdad (la genera InvimÁgil Base)
  _invimagil/MAESTRO NSO.xlsx   ← para la analista
  *.pdf                         ← adjuntos

Extensión "InvimÁgil Inyector" (MV3)
  side panel (UI, español)      ← elegir carpeta · detectar pantalla · Llenar · Verificar · Log
  content script (mundo aislado)← escribe en los controles Ant Design
  script de lectura (mundo MAIN)← lee request.content de la caché Apollo para verificar
  mapa-formulario.json          ← por pantalla: campo de la planilla → control → tipo de control
  catálogo                      ← mismas listas que el extractor, para normalizar nombres
```

Permisos: solo `https://invimagil.invima.gov.co/*`, `sidePanel`, `storage`, `scripting`. **Sin ninguna llamada de red**: la extensión no habla con la API de Anthropic ni con ningún servidor. Toda la inteligencia ya ocurrió al generar el maestro.

### 4.2 Flujo de la analista

1. Abre el trámite en InvimÁgil (sesión iniciada como siempre) y abre el panel lateral de la extensión.
2. **«Elegir carpeta del producto»** → selector de carpeta del sistema. El panel lee `_invimagil/planilla.json`, muestra producto, número de ingredientes, decisiones pendientes y pide confirmar el **Id de la solicitud** que aparece en pantalla. Si la planilla tiene decisiones abiertas, avisa cuáles campos quedarán vacíos.
3. El panel detecta la pantalla actual por el encabezado («NSO de Cosméticos – Composición») y muestra qué va a llenar. Botón **«Llenar esta pantalla»**.
4. El add-on escribe campo por campo con ritmo humano (150 a 400 ms entre acciones). En listas: abre, filtra, espera opciones, elige la coincidencia exacta. En tablas: «+ Agregar», llena el modal, **Guardar dentro del modal** (solo agrega la fila), verifica que la fila apareció, siguiente.
5. Al terminar muestra la **tabla de verificación**: campo · valor del maestro · valor en la plataforma · ✓/✗. La lectura se hace del DOM y, cuando está disponible, de `request.content` en la caché Apollo (lo que la plataforma realmente guardó).
6. La analista corrige a mano lo que esté en ✗ (o lo deja para después), y **pulsa Siguiente ella misma**. El add-on nunca pulsa Siguiente, Guardar y enviar, Finalizar, ni marca Términos y condiciones.
7. Cada pantalla deja un registro en `_invimagil/log-inyeccion.md` (hora, campos escritos, diferencias, ingredientes no encontrados) y un `verificacion-<paso>.json`. Esto cierra el ciclo documento → maestro → plataforma → comparación.

### 4.3 Reglas de seguridad (no negociables, en código)

- Lista blanca de botones que puede pulsar: «+ Agregar…», «Guardar» dentro de un modal, «Cancelar». Todo lo demás está bloqueado por texto y por posición (barra de navegación del asistente).
- Solo actúa si la URL contiene el Id de solicitud confirmado en el panel y el encabezado coincide con la pantalla elegida. Si cambian, se detiene.
- **Nunca elige «la opción más parecida».** Sin coincidencia exacta (ignorando mayúsculas y tildes) el campo queda vacío y se reporta.
- Si un modal falla a medias, pulsa Cancelar; nunca guarda una fila incompleta.
- Modo **«Solo mostrar»**: resalta los controles que llenaría, sin escribir. Para la primera vez en cada pantalla y para capacitación.
- Nunca toca credenciales, cookies ni almacenamiento de la plataforma. Nada sale del equipo.

### 4.4 Composición en detalle (la pantalla que paga el proyecto)

Por cada ingrediente de la planilla, en orden del COCC:

1. «+ Agregar ingrediente» → modal.
2. INCI: escribe en el autocompletado, espera la respuesta del servidor (debounce + spinner), busca la opción cuyo texto sea **exactamente** el INCI; la elige. Si no existe → Cancelar, anotar «no encontrado: <INCI>», seguir con el siguiente.
3. Listado de referencia: de las opciones que ofrece la plataforma para ese INCI, aplica la preferencia **UE > PCPC > FDA**.
4. Tipo (básico / secundario), función (cosmFun), cantidad con todos los decimales, unidad, nanomaterial.
5. Guardar en el modal → verificar la fila nueva en la tabla (INCI, cantidad).
6. Al final: resumen con suma de porcentajes leída de la tabla, lista de no encontrados y de ingredientes que quedaron con un listado distinto al preferido.

Estimación: 4 a 6 segundos por ingrediente → 40 ingredientes en 3 a 4 minutos, con la analista mirando.

### 4.5 Pantallas Sistematización e Inicio

La planilla actual no trae las 17 preguntas Sí/No de «Inicio» ni los datos de la NSO vigente para sistematizaciones. Propuesta: ampliar el esquema del extractor con `initialValidation` (respuesta propuesta + fuente por pregunta) y `sistematizacion` (número de NSO, fechas, acto administrativo), marcados como decisión cuando no salgan de los documentos. El add-on los llena como cualquier otro campo y la analista confirma.

### 4.6 Documentos (pantallas 7 y 8)

Con la carpeta elegida, el add-on puede adjuntar directamente cada PDF en su casilla (asigna el archivo al `input[type=file]` oculto, sin abrir el diálogo nativo) y verificar que el nombre aparece. Reglas: un PDF ≤ 10 MB por casilla; si la planilla indica varios archivos para una casilla o excede el tamaño, no adjunta y lo reporta. Unir y comprimir PDFs es trabajo del extractor (siguiente versión), no del add-on.

## 5. Distribución e instalación (sin permisos de administrador)

Orden de preferencia:

1. **Edge Add-ons, publicación «no listada»** (cuenta de desarrollador gratuita). SPI recibe un enlace privado, instala con un clic y las actualizaciones llegan solas. Es lo que se recomienda para Laura.
2. **Chrome Web Store no listada** (USD 5 una vez), para quien use Chrome.
3. Respaldo: carpeta descomprimida + «Cargar desempaquetada» en modo desarrollador de Edge. Funciona sin admin, pero hay que confirmar que la política corporativa de SPI no bloquea extensiones fuera de la tienda; conviene preguntarle a Juliana antes del piloto.

## 6. Plan de trabajo

| Fase | Contenido | Entregable | Esfuerzo estimado |
|---|---|---|---|
| **0. Mapa de controles** | Sesión de 1 hora con Laura y el usuario de prueba: con el mapper (ya existe) se capturan los ids de las 9 pantallas, incluidos los modales de Presentaciones, Ingredientes y Parámetros. Se exporta `request.content` de un trámite ya completo para conocer la forma final de cada campo. | `mapa-formulario.json` v1 | 1 sesión + 1 día |
| **1. Núcleo + pantallas simples** | Extensión MV3 con panel lateral, lector de carpeta, detección de pantalla, motor de escritura Ant Design (texto, select, switch, fecha), verificación DOM + Apollo, log. Pantallas: Información General (incl. presentaciones por modal), Información de Uso, Características Técnicas. Réplica local del formulario (`tools/mock-invimagil.html` ampliado) con pruebas automatizadas. | Extensión v0.1 probada contra el mock | 1,5 a 2 semanas |
| **2. Composición** | Autocompletado INCI con coincidencia exacta, preferencia UE > PCPC > FDA, reporte de no encontrados, suma de porcentajes. Ensayo en vivo sobre un borrador de prueba, nunca enviado. | Extensión v0.2 | 1 semana |
| **3. Documentos + Inicio/Sistematización** | Adjuntar PDFs desde la carpeta; ampliar el esquema del extractor con las 17 preguntas y datos de NSO vigente. | Extensión v0.3 + InvimÁgil Base v0.2 | 1 semana |
| **4. Piloto y distribución** | Publicación no listada en Edge Add-ons, guía de una página, piloto con 3 productos (1 simple, 2 complejos) midiendo tiempo por pantalla, campos corregidos a mano e ingredientes no encontrados. | Informe de piloto; decisión de reducir el control humano a solo post-inyección | 2 semanas de calendario |

Qué necesito de SPI para arrancar la Fase 0: una hora de Laura con el usuario de prueba y un borrador de trámite, y el visto bueno de Juliana sobre la instalación de extensiones en los equipos.

## 7. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| INVIMA cambia el formulario y los ids | El mapa es un archivo de datos, no código; el panel detecta controles que no encuentra y lo reporta; el mapper permite re-mapear en una sesión. |
| El autocompletado de INCI no devuelve el nombre exacto del COCC | Regla de no inventar: se reporta; con el log de «no encontrados» se construye un diccionario de sinónimos revisado por Laura (p. ej. «PERFUME/FRAGRANCE» vs. «PARFUM»), que luego se aplica tanto en el extractor como en el add-on. |
| Comportamiento «no humano» detectado por la plataforma | Ritmo humano, una pantalla a la vez, siempre con la analista presente, sin bot nocturno. |
| Política corporativa bloquea extensiones | Publicación en tienda oficial (no listada) y consulta previa a Juliana. |
| La verificación por DOM no refleja lo guardado | Segunda lectura desde `request.content` en la caché Apollo y, al final, comparación con el PDF resumen que genera la plataforma. |

## 8. Decisión que se pide

1. Aprobar la **opción A** (extensión MV3 para Edge/Chrome) con distribución **no listada en Edge Add-ons**.
2. Agendar la **sesión de mapeo (Fase 0)** con Laura.
3. Confirmar con Juliana la **política de extensiones** de los equipos de SPI.
