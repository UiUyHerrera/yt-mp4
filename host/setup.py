import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

import tools

EXTENSION_ID = "bcgedkiaohjneocngfolnbicpfeaiamm"
GECKO_ID = "ytmp4@local"
HOST_NAME = "com.ytmp4.host"
FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
DENO_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
QUIET = "--update" in sys.argv


def say(text=""):
    if not QUIET:
        print(text, flush=True)


def step(n, text):
    say(f" [{n}/5] {text}")


def fail(text):
    print(f"\n ERROR: {text}", flush=True)
    sys.exit(1)


def fetch(url, dest, label):
    req = urllib.request.Request(url, headers={"User-Agent": "yt-mp4"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        shown = -1
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total and not QUIET:
                pct = done * 100 // total
                if pct // 10 != shown // 10:
                    shown = pct
                    print(f"\r       Descargando {label}: {pct}%", end="", flush=True)
    say(f"\r       Descargando {label}: listo      ")


def extract(zip_path, wanted, target):
    os.makedirs(target, exist_ok=True)
    got = set()
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            name = os.path.basename(info.filename).lower()
            if name in wanted and not info.is_dir():
                with z.open(info) as src, open(os.path.join(target, name), "wb") as dst:
                    shutil.copyfileobj(src, dst)
                got.add(name)
    missing = set(wanted) - got
    if missing:
        fail(f"El archivo descargado no trae {', '.join(sorted(missing))}.")


def ensure_ytdlp():
    step(2, "Instalando yt-dlp")
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "--quiet", "yt-dlp[default]"]
    if subprocess.run(cmd).returncode != 0:
        subprocess.run([sys.executable, "-m", "ensurepip", "--upgrade"], capture_output=True)
        if subprocess.run(cmd).returncode != 0:
            fail("No se pudo instalar yt-dlp. Revisa tu conexion a internet y vuelve a abrir install.bat.")
    say("       Listo.")


def ensure_ffmpeg():
    step(3, "Buscando ffmpeg")
    if tools.ffmpeg_dir():
        say("       Ya estaba instalado.")
        return
    with tempfile.TemporaryDirectory() as tmp:
        z = os.path.join(tmp, "ffmpeg.zip")
        fetch(FFMPEG_URL, z, "ffmpeg (unos 110 MB)")
        extract(z, {"ffmpeg.exe", "ffprobe.exe"}, os.path.join(tools.TOOLS, "ffmpeg"))
    say("       Listo.")


def ensure_js():
    step(4, "Buscando Deno o Node")
    if tools.js_runtimes():
        say("       Ya estaba instalado.")
        return
    with tempfile.TemporaryDirectory() as tmp:
        z = os.path.join(tmp, "deno.zip")
        fetch(DENO_URL, z, "Deno (unos 45 MB)")
        extract(z, {"deno.exe"}, os.path.join(tools.TOOLS, "deno"))
    say("       Listo.")


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
    ensure_ffmpeg()
    ensure_js()
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
