# YT MP4

Extensión para Chrome, Edge, Brave y Firefox que descarga videos de YouTube en MP4 o MP3.

## Instalar

1. Descarga `yt-mp4.zip` de la última versión en Releases y descomprímelo en una carpeta fija, por ejemplo `C:\YT MP4`.
2. Abre `install.bat`. Instala lo que falte (Python, yt-dlp, ffmpeg y Deno) y conecta la extensión con el navegador.
3. En el navegador abre la página de extensiones, activa el modo desarrollador y usa "Cargar descomprimida" con la carpeta `extension`.
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Firefox: `about:debugging#/runtime/this-firefox`, "Cargar complemento temporal" y elige `extension\manifest.json`.

No muevas ni borres la carpeta después de instalar.

## Uso

- Abre un video de YouTube, toca el ícono, elige Video o Audio y la calidad, y toca Descargar.
- Atajos: `Ctrl+Shift+4` descarga en MP4 y `Ctrl+Shift+3` en MP3.
- En Ajustes (engranaje) eliges la carpeta de los MP4 y la de los MP3, y cambias los atajos.

## Actualizaciones

La extensión revisa cada 6 horas si hay una versión nueva en Releases y se actualiza sola. También se puede buscar a mano en Ajustes.

## Publicar una versión

1. Sube el número en `extension/manifest.json`.
2. `python build.py`
3. `gh release create v<versión> dist/yt-mp4.zip --title v<versión>`
