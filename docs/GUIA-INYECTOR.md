# Guía: llenar un trámite de NSO con el Inyector

Para quien tenga acceso a InvimÁgil desde Colombia (Juliana o Laura). InvimÁgil no acepta
conexiones desde fuera de Colombia, así que esta parte solo se puede hacer allá.

## Qué hace

1. **SPI Sistematización** lee la carpeta del producto con Gemini y arma la planilla. También
   prepara un PDF por casilla de documentos: une los archivos y los comprime a menos de 10 MB.
2. La analista revisa la planilla, cierra las decisiones y la aprueba.
3. El **Inyector** (extensión de Edge o Chrome) llena el borrador en InvimÁgil pantalla por
   pantalla y pulsa «Siguiente» hasta llegar a **Términos y condiciones**. Allí se detiene.
4. La analista revisa el borrador, acepta los términos y radica. **Eso siempre lo hace una persona.**

En cada pantalla que llena, el Inyector guarda en SPI Sistematización lo que encontró: los
controles y las llamadas que hace la plataforma. Con eso se ajusta el mapa de pantallas.

## 1. Instalar la extensión (una sola vez)

1. Descomprima `InvimagilInyector-0.3.0.zip` en una carpeta fija, por ejemplo `Documentos\InvimagilInyector`.
2. En Edge abra `edge://extensions` (en Chrome, `chrome://extensions`).
3. Active **Modo de desarrollador**.
4. Pulse **Cargar desempaquetada** y elija la carpeta del paso 1.
5. Fije el ícono de la extensión en la barra (pieza de rompecabezas → alfiler).

Para actualizar a una versión nueva, reemplace el contenido de esa carpeta y pulse el botón de
recargar de la extensión en `edge://extensions`.

## 2. Preparar el trámite en SPI Sistematización

En **https://spi-sistematizaciones.web.app**, en el trámite:

1. **Datos del trámite**: número de NSO, fechas, Id de la solicitud de InvimÁgil (aparece en la
   dirección del borrador) y el **último documento oficial de la NSO**. Si no está en la carpeta, súbalo ahí mismo.
2. **Documentos para InvimÁgil** → **Preparar documentos**. Revise los avisos: un archivo Word
   se carga a mano y un PDF que se convirtió a imagen hay que mirarlo.
3. **Llenado con la extensión** → **Enviar a la extensión**.

Deje abierta esta pestaña mientras trabaja: por ella llegan los resultados a la app.

## 3. Mezclas (antes de Composición)

Si el panel avisa que hay mezclas:

1. En InvimÁgil vaya a **Administración de Ingredientes → Mezclas**.
2. Abra el panel del Inyector → **Una pantalla a la vez** → **Crear las mezclas**.
3. Revise la tabla de mezclas en la plataforma.

## 4. Llenar el borrador

1. En InvimÁgil cree el borrador: **NSO → Gestionar NSO → Nueva solicitud**. Quedará en la
   pantalla «Sistematización».
2. Abra el panel del Inyector, elija el trámite y confirme el Id de la solicitud.
3. Pulse **Llenar todo hasta Términos**.
   - Con «Detenerse en una pantalla con problemas» marcado, se detiene donde algo no cuadra. Corrija
     a mano y vuelva a pulsar: sigue desde la pantalla en que está.
   - **Pausar** detiene el recorrido al terminar el campo en curso.
4. Al llegar a Términos y condiciones, revise el borrador completo, acepte y radique usted.

En el panel, cada campo aparece así:

- ✓ quedó como dice la planilla.
- ≠ la plataforma muestra otra cosa.
- ✗ dio error.
- ? no se encontró el control.
- … no hay dato en la planilla.

Lo que el panel marca como «ubicado por etiqueta aproximada» también hay que mirarlo.

## Primera vez: corrida de prueba

La primera vez hágalo con un borrador de prueba que se pueda descartar, y **desmarque**
«Detenerse en una pantalla con problemas». Así recorre todo y deja registradas todas las pantallas.

Donde la plataforma no deje avanzar porque falta un dato obligatorio:

1. Escríbalo a mano.
2. Pulse **Llenar todo hasta Términos** de nuevo.

Abra también cada «+ Agregar…» que el Inyector no haya llenado y, con el modal abierto, pulse
**Mapeo de pantallas → Capturar esta pantalla**. Después cierre el modal con Cancelar.

Al terminar, avise a Edmundo: con lo registrado se ajusta el mapa y la siguiente corrida ya es real.

## Qué nunca hace la extensión

- No acepta términos, no firma, no radica, no envía, no pulsa «Finalizar» ni «Anterior».
- Solo pulsa «Siguiente» dentro del recorrido automático, y nunca en Términos.
- No guarda ni envía claves: usa la sesión de InvimÁgil que usted ya abrió.
- Solo habla con InvimÁgil y con SPI Sistematización.
