# InvimÁgil Base — instrucciones

Genera, a partir de la carpeta de documentos de un producto, el **Excel maestro** con toda la información en el orden del formulario de InvimÁgil, lista para copiar y pegar.

## Instalar (una sola vez, 2 minutos)

1. **Descomprime el zip antes de abrir nada**: clic derecho sobre el archivo `.zip` → **«Extraer todo…»** → elige **Documentos** → Extraer. Queda la carpeta `Documentos\InvimagilBase`. **No la muevas ni la borres después.**
   No hagas doble clic dentro del zip: Windows lo abre en una carpeta temporal y la instalación falla.
2. Doble clic en **`Instalar.bat`**.
   Si Windows muestra «Windows protegió su PC»: clic en *Más información* → *Ejecutar de todas formas*.
3. Cuando lo pida, pega la **clave** que te envió Edmundo y presiona Enter. No se ve al escribir; es normal.
4. Aparece «Instalación lista». Desde ahora tienes dos opciones nuevas en el clic derecho de cualquier carpeta.

## Generar el archivo base de un producto

1. Baja la **carpeta completa** del cliente a tu disco: todos los documentos del producto en una sola carpeta (PDF, Word, Excel, imágenes).
2. **Clic derecho sobre la carpeta → «Generar archivo base InvimÁgil».**
3. Se abre una ventana negra con el avance. Tarda **entre 3 y 8 minutos**. No la cierres.
4. Al terminar, se abre el Excel `MAESTRO NSO - <producto>.xlsx`. Queda guardado en la subcarpeta `_invimagil` dentro de la carpeta del producto.

## Responder las decisiones

El Excel tiene una hoja **Decisiones** con lo que la herramienta no pudo cerrar sola (responsable técnico, archivos que hay que unir, datos que se contradicen, etc.).

1. Escribe tu respuesta en la **columna amarilla**. Guarda y **cierra** el Excel.
2. **Clic derecho sobre la carpeta → «Aplicar decisiones InvimÁgil».**
3. El Excel se vuelve a generar con tus respuestas aplicadas. Las decisiones resueltas quedan en el histórico de la misma hoja.

## Qué hace y qué no hace

- Lee los documentos y los envía a la API de Anthropic, **configurada sin retención de datos**, para extraer la información. No los sube a ningún otro lugar.
- **No modifica** los documentos originales. Todo lo nuevo queda en `_invimagil`.
- **No entra a InvimÁgil.** El Excel sirve para copiar, pegar y verificar; el formulario lo llenas y lo envías tú.
- Cada ejecución queda registrada en `_invimagil/log-nso.md`.

## Si algo falla

Toma una captura de la ventana y escríbele a Edmundo. No intentes arreglarlo. El detalle técnico queda en `_invimagil/ultimo-error.txt`.

Casos frecuentes:
- **«El Excel está abierto»**: ciérralo y vuelve a intentar.
- **«No hay respuestas en la columna amarilla»**: escribiste en otra columna o no guardaste el Excel.
- **La ventana se cierra de inmediato**: la carpeta `InvimagilBase` se movió. Vuelve a ejecutar `Instalar.bat` desde su ubicación nueva.
- **«Instalación incompleta» o «se está ejecutando desde dentro del .zip»**: extrae el zip con «Extraer todo…» en Documentos y ejecuta `Instalar.bat` desde la carpeta extraída.
