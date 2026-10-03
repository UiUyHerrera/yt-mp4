import os
import shutil
import tempfile
import urllib.request
import zipfile

HOST = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HOST)
TOOLS = os.path.join(ROOT, "tools")
LINKS = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links")
FFMPEG_URLS = [
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
]
DENO_URLS = [
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip",
]


def _first(paths):
    for p in paths:
        if p and os.path.isfile(p):
            return p
    return None


def ffmpeg_dir():
    found = shutil.which("ffmpeg")
    candidates = [
        os.path.join(os.path.dirname(found), "ffmpeg.exe") if found else None,
        os.path.join(TOOLS, "ffmpeg", "ffmpeg.exe"),
        os.path.join(os.path.expanduser("~"), "ffmpeg", "bin", "ffmpeg.exe"),
        os.path.join(LINKS, "ffmpeg.exe"),
    ]
    exe = _first(candidates)
    if exe and os.path.isfile(os.path.join(os.path.dirname(exe), "ffprobe.exe")):
        return os.path.dirname(exe)
    return None


def js_runtimes():
    found = {}
    deno = _first([shutil.which("deno"), os.path.join(TOOLS, "deno", "deno.exe"), os.path.join(LINKS, "deno.exe")])
    if deno:
        found["deno"] = {"path": deno}
    node = shutil.which("node")
    if node:
        found["node"] = {"path": node}
    return found


def fetch(url, dest, progress=None):
    req = urllib.request.Request(url, headers={"User-Agent": "yt-mp4"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if progress and total:
                progress(done * 100 // total)


def install_zip(urls, wanted, target, label, progress=None):
    errors = []
    for url in urls:
        for _ in range(2):
            try:
                with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
                    z = os.path.join(tmp, "download.zip")
                    fetch(url, z, progress)
                    stage = os.path.join(tmp, "out")
                    os.makedirs(stage)
                    with zipfile.ZipFile(z) as zf:
                        for info in zf.infolist():
                            name = os.path.basename(info.filename).lower()
                            if name in wanted and not info.is_dir():
                                with zf.open(info) as src, open(os.path.join(stage, name), "wb") as dst:
                                    shutil.copyfileobj(src, dst)
                    missing = set(wanted) - set(os.listdir(stage))
                    if missing:
                        raise RuntimeError(f"el archivo no trae {', '.join(sorted(missing))}")
                    os.makedirs(target, exist_ok=True)
                    for name in wanted:
                        os.replace(os.path.join(stage, name), os.path.join(target, name))
                return
            except Exception as e:
                errors.append(f"{url.split('/')[2]}: {e}")
    raise RuntimeError(f"No se pudo bajar {label}. " + " | ".join(errors[-2:]))


def ensure_ffmpeg(progress=None):
    if ffmpeg_dir():
        return False
    install_zip(FFMPEG_URLS, {"ffmpeg.exe", "ffprobe.exe"}, os.path.join(TOOLS, "ffmpeg"), "ffmpeg", progress)
    return True


def ensure_js(progress=None):
    if js_runtimes():
        return False
    install_zip(DENO_URLS, {"deno.exe"}, os.path.join(TOOLS, "deno"), "Deno", progress)
    return True
