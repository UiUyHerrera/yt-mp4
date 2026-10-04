# mpeasy

Descargar canciones o videos de YT. Extensión para Edge, Chrome, Brave y Firefox que baja cualquier video de YouTube como video (MP4) o como canción (MP3).

## Cómo funciona

1. Abres un video en YouTube.
2. Tocas el ícono de la extensión.
3. Eliges **Video** o **Audio** y la calidad.
4. Tocas **Descargar**.

El archivo queda en tu carpeta de Descargas. En **Ajustes** (el engranaje) puedes elegir una carpeta para los videos y otra para las canciones.

También puedes descargar con el teclado, sin abrir la extensión:

- `Ctrl + Shift + 4` baja el video.
- `Ctrl + Shift + 3` baja la canción.

Cada descarga se puede pausar, reanudar o cancelar desde la lista.

La extensión se actualiza sola cuando sale una versión nueva y te muestra la lista de cambios.

Por dentro, la extensión le pasa el link a un programa que corre en tu PC y que hace la descarga. Por eso hay que abrir el instalador una vez.

## Cómo instalarla

1. **Baja el archivo:** [yt-mp4.zip](https://github.com/UiUyHerrera/yt-mp4/releases/latest/download/yt-mp4.zip)
2. **Descomprímelo:** clic derecho en el archivo y **Extraer todo**. Déjalo en una carpeta que no vayas a mover, por ejemplo `C:\YT MP4`.
3. **Abre `install.bat`** con doble clic y espera a que diga **Todo listo**. Si a tu PC le falta algo, lo instala solo. La primera vez puede tardar unos minutos.
   - Si Windows dice "Windows protegió su PC", toca **Más información** y después **Ejecutar de todas formas**.
4. **Agrega la extensión al navegador:**
   - Abre la página de extensiones: `edge://extensions`, `chrome://extensions` o `brave://extensions`.
   - Activa **Modo de desarrollador**.
   - Toca **Cargar desempaquetada** (en Chrome se llama **Cargar descomprimida**) y elige la carpeta `extension`, que está dentro de la carpeta del paso 2.
5. **Listo.** Abre un video de YouTube y toca el ícono de la extensión. Si no lo ves, búscalo en el ícono de pieza de puzzle de la barra del navegador y fíjalo.

En Firefox: abre `about:debugging#/runtime/this-firefox`, toca **Cargar complemento temporal** y elige `extension\manifest.json`. Firefox la quita cada vez que se cierra.

## Si algo falla

- Abre `install.bat` de nuevo. Si sale un **ERROR**, ahí dice qué falta.
- No muevas ni borres la carpeta después de instalar. Si la mueves, abre `install.bat` otra vez desde la carpeta nueva.
