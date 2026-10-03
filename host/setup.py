import json
import os
import struct
import subprocess
import sys

import tools

EXTENSION_ID = "bcgedkiaohjneocngfolnbicpfeaiamm"
GECKO_ID = "ytmp4@local"
HOST_NAME = "com.ytmp4.host"
QUIET = "--update" in sys.argv


def say(text=""):
    if not QUIET:
        print(text, flush=True)


def step(n, text):
    say(f" [{n}/5] {text}")


def fail(text):
    print(f"\n ERROR: {text}", flush=True)
    sys.exit(1)


class Progress:
    def __init__(self, label):
        self.label = label
        self.shown = -1

    def __call__(self, pct):
        if not QUIET and pct // 5 != self.shown // 5:
            self.shown = pct
            print(f"\r       Descargando {self.label}: {pct}%   ", end="", flush=True)


def ensure_ytdlp():
    step(2, "Instalando yt-dlp")
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "--quiet", "yt-dlp[default]"]
    if subprocess.run(cmd).returncode != 0:
        subprocess.run([sys.executable, "-m", "ensurepip", "--upgrade"], capture_output=True)
        if subprocess.run(cmd).returncode != 0:
            fail("No se pudo instalar yt-dlp. Revisa tu conexion a internet y vuelve a abrir install.bat.")
    say("       Listo.")


def ensure_tool(n, title, label, ensure):
    step(n, title)
    try:
        installed = ensure(Progress(label))
    except RuntimeError as e:
        say()
        fail(f"{e} Revisa tu conexion a internet y vuelve a abrir install.bat.")
    say("\r       Listo.                              " if installed else "       Ya estaba instalado.")


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def write_files():
    bat = os.path.join(tools.HOST, "host.bat")
    with open(bat, "w", encoding="oem", newline="\r\n") as f:
        f.write("@echo off\n")
        f.write(f'"{sys.executable}" -u "%~dp0host.py" %*\n')
    base = {"name": HOST_NAME, "description": "YT MP4 host", "path": bat, "type": "stdio"}
    chromium = os.path.join(tools.HOST, f"{HOST_NAME}.json")
    firefox = os.path.join(tools.HOST, f"{HOST_NAME}.firefox.json")
    write_json(chromium, {**base, "allowed_origins": [f"chrome-extension://{EXTENSION_ID}/"]})
    write_json(firefox, {**base, "allowed_extensions": [GECKO_ID]})


def selftest():
    step(5, "Probando")
    data = json.dumps({"type": "ping"}).encode()
    bat = os.path.join(tools.HOST, "host.bat")
    try:
        p = subprocess.run(["cmd", "/c", bat], input=struct.pack("<I", len(data)) + data, capture_output=True, timeout=60)
    except subprocess.TimeoutExpired:
        fail("El programa local no respondio.")
    out = p.stdout
    if len(out) < 4:
        fail("El programa local no respondio. " + p.stderr.decode(errors="replace").strip()[-300:])
    size = struct.unpack("<I", out[:4])[0]
    try:
        reply = json.loads(out[4:4 + size])
    except ValueError:
        fail("El programa local respondio algo raro: " + out[:120].decode(errors="replace"))
    if reply.get("type") != "pong":
        fail(reply.get("message") or "Respuesta inesperada del programa local.")
    say(f"       yt-dlp {reply.get('ytdlp')}, ffmpeg {'OK' if reply.get('ffmpeg') else 'NO'}, JS {', '.join(reply.get('js') or ['NO'])}")
    if not reply.get("ffmpeg") or not reply.get("js"):
        fail("Falta ffmpeg o Deno. Vuelve a abrir install.bat.")


def main():
    if sys.version_info < (3, 10):
        fail("Se necesita Python 3.10 o mas nuevo. Instalalo desde https://www.python.org/downloads/")
    if "--files" in sys.argv:
        write_files()
        return
    ensure_ytdlp()
    ensure_tool(3, "Buscando ffmpeg", "ffmpeg (unos 110 MB, no cierres esta ventana)", tools.ensure_ffmpeg)
    ensure_tool(4, "Buscando Deno o Node", "Deno (unos 45 MB)", tools.ensure_js)
    if QUIET:
        write_files()
        return
    selftest()
    say()
    say(" Todo listo.")
    say(" Chrome / Edge / Brave: abre la pagina de extensiones, activa el modo desarrollador")
    say(' y usa "Cargar descomprimida" con la carpeta:')
    say(f"   {os.path.join(tools.ROOT, 'extension')}")
    say(" Firefox: about:debugging#/runtime/this-firefox > Cargar complemento temporal > extension\\manifest.json")


if __name__ == "__main__":
    main()
