import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile

out = sys.stdout.buffer
sys.stdout = sys.stderr

import tools

SEND_LOCK = threading.Lock()


def send(msg):
    data = json.dumps(msg).encode("utf-8")
    with SEND_LOCK:
        out.write(struct.pack("<I", len(data)))
        out.write(data)
        out.flush()


def receive():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    size = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(size).decode("utf-8"))


CLIENTS = [None, ["tv", "android_vr"], ["web_safari", "mweb"], ["ios"]]
ANSI = re.compile(r"\x1b\[[0-9;]*m")


class Cancelled(BaseException):
    pass


class Control:
    def __init__(self):
        self.cancelled = threading.Event()
        self.running = threading.Event()
        self.running.set()

    def listen(self):
        while True:
            try:
                msg = receive()
            except (OSError, ValueError):
                msg = None
            if not isinstance(msg, dict):
                self.cancelled.set()
                self.running.set()
                return
            kind = msg.get("type")
            if kind == "pause" and not self.cancelled.is_set():
                self.running.clear()
                send({"type": "paused"})
            elif kind == "resume":
                self.running.set()
                send({"type": "resumed"})
            elif kind == "cancel":
                self.cancelled.set()
                self.running.set()

    def checkpoint(self):
        self.running.wait()
        if self.cancelled.is_set():
            raise Cancelled()


def remove_created(paths, since):
    for path in paths:
        for candidate in (path, path + ".part", path + ".ytdl"):
            try:
                if os.path.isfile(candidate) and os.path.getmtime(candidate) >= since:
                    os.remove(candidate)
            except OSError:
                pass


MISSING = "Falta yt-dlp en este PC. Abre install.bat de la extension."
RELEASE_FILES = ("extension/", "host/", "install.bat", "update.json")
KEEP = {"host/host.bat", "host/com.ytmp4.host.json", "host/com.ytmp4.host.firefox.json"}


def load_ytdlp():
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError(MISSING)
    return yt_dlp


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3])


def update_config():
    try:
        with open(os.path.join(tools.ROOT, "update.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def refresh_ytdlp():
    stamp = os.path.join(tools.HOST, ".ytdlp-checked")
    try:
        if time.time() - os.path.getmtime(stamp) < 86400:
            return
    except OSError:
        pass
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "--quiet", "yt-dlp[default]"]
    if subprocess.run(cmd, capture_output=True, timeout=300).returncode == 0:
        with open(stamp, "w") as f:
            f.write(str(int(time.time())))


def http_get(url, accept="application/octet-stream"):
    req = urllib.request.Request(url, headers={"User-Agent": "yt-mp4", "Accept": accept})
    return urllib.request.urlopen(req, timeout=60)


def release_members(z):
    names = [i.filename for i in z.infolist() if not i.is_dir()]
    prefix = os.path.commonprefix(names)
    prefix = prefix[: prefix.rfind("/") + 1] if "/" in prefix else ""
    members = {}
    for info in z.infolist():
        if info.is_dir():
            continue
        rel = info.filename[len(prefix):].replace("\\", "/")
        parts = rel.split("/")
        if not rel or rel.startswith("/") or ".." in parts or ":" in rel:
            raise RuntimeError("La actualizacion trae rutas invalidas.")
        if rel.startswith(RELEASE_FILES) and rel not in KEEP:
            members[rel] = info
    if "extension/manifest.json" not in members or "host/host.py" not in members:
        raise RuntimeError("La actualizacion esta incompleta.")
    return members


def apply_release(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        members = release_members(z)
        with tempfile.TemporaryDirectory(dir=tools.ROOT) as stage:
            for rel, info in members.items():
                dest = os.path.join(stage, *rel.split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with z.open(info) as src, open(dest, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            for rel in members:
                final = os.path.join(tools.ROOT, *rel.split("/"))
                os.makedirs(os.path.dirname(final), exist_ok=True)
                os.replace(os.path.join(stage, *rel.split("/")), final)
    ext = os.path.join(tools.ROOT, "extension")
    for base, _, files in os.walk(ext):
        for name in files:
            rel = os.path.relpath(os.path.join(base, name), tools.ROOT).replace(os.sep, "/")
            if rel not in members:
                os.remove(os.path.join(base, name))


def update(current):
    refresh_ytdlp()
    config = update_config()
    repo = config.get("repo")
    if not repo:
        send({"type": "uptodate", "disabled": True})
        return
    api = config.get("api", "https://api.github.com").rstrip("/")
    with http_get(f"{api}/repos/{repo}/releases/latest", "application/vnd.github+json") as r:
        release = json.load(r)
    latest = release.get("tag_name", "").lstrip("v")
    if not latest or version_tuple(latest) <= version_tuple(current):
        send({"type": "uptodate", "latest": latest})
        return
    asset = next((a for a in release.get("assets", []) if a.get("name") == "yt-mp4.zip"), None)
    if not asset:
        raise RuntimeError(f"La version {latest} no trae yt-mp4.zip.")
    send({"type": "update-found", "version": latest})
    with tempfile.TemporaryDirectory() as tmp:
        z = os.path.join(tmp, "yt-mp4.zip")
        with http_get(asset["browser_download_url"]) as r, open(z, "wb") as f:
            shutil.copyfileobj(r, f)
        apply_release(z)
    subprocess.run([sys.executable, os.path.join(tools.HOST, "setup.py"), "--update"], capture_output=True, timeout=900)
    send({"type": "updated", "version": latest})


def ping():
    try:
        yt_dlp = load_ytdlp()
        version = yt_dlp.version.__version__
    except RuntimeError:
        version = None
    send({
        "type": "pong",
        "ytdlp": version,
        "ffmpeg": bool(tools.ffmpeg_dir()),
        "js": sorted(tools.js_runtimes()),
        "python": sys.version.split()[0],
    })
    if not version:
        raise RuntimeError(MISSING)


def fmt(quality):
    if quality == "best":
        return "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b"
    h = f"[height<={int(quality)}]"
    return (
        f"bv*{h}[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/"
        f"bv*{h}[ext=mp4]+ba[ext=m4a]/"
        f"b{h}[ext=mp4]/"
        f"bv*{h}+ba/b{h}"
    )


def default_folder():
    return os.path.join(os.path.expanduser("~"), "Downloads")


def resolve_folder(folder):
    folder = (folder or "").strip().strip('"')
    if not folder:
        return default_folder()
    folder = os.path.expandvars(os.path.expanduser(folder))
    if not os.path.isabs(folder):
        raise ValueError(f"Escribe la ruta completa de la carpeta, por ejemplo C:\\Videos. Recibí: {folder}")
    folder = os.path.normpath(folder)
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError as e:
        raise ValueError(f"No se pudo usar la carpeta {folder}: {e.strerror}")
    return folder


def bring_to_front(root):
    import ctypes

    user32 = ctypes.windll.user32
    hwnd = user32.GetParent(root.winfo_id()) or root.winfo_id()
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.ShowWindow(hwnd, 5)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    root.focus_force()
    root.update()


def pick_folder(current, title):
    import tkinter
    from tkinter import filedialog

    root = tkinter.Tk()
    root.overrideredirect(True)
    root.geometry("1x1+0+0")
    root.attributes("-alpha", 0)
    root.attributes("-topmost", True)
    root.update()
    bring_to_front(root)
    start = current if current and os.path.isdir(current) else default_folder()
    path = filedialog.askdirectory(parent=root, initialdir=start, title=title or "Carpeta de descarga")
    root.destroy()
    send({"type": "folder", "path": os.path.normpath(path) if path else ""})


def reveal(path):
    path = os.path.normpath(path or "")
    if not path or not os.path.isfile(path):
        send({"type": "error", "message": "El archivo ya no está en esa carpeta."})
        return
    subprocess.Popen(["explorer", "/select,", path])
    send({"type": "revealed"})


def ensure_tools(control):
    for label, present, ensure in (("ffmpeg", tools.ffmpeg_dir, tools.ensure_ffmpeg), ("Deno", tools.js_runtimes, tools.ensure_js)):
        if present():
            continue
        send({"type": "status", "text": f"Instalando {label}"})
        last = [-2]

        def progress(pct):
            control.checkpoint()
            if pct - last[0] >= 2:
                last[0] = pct
                send({"type": "progress", "percent": pct})

        ensure(progress)
        send({"type": "status", "text": ""})
        send({"type": "progress", "percent": 0})


def download(url, quality, folder, control):
    yt_dlp = load_ytdlp()
    state = {"last": -1.0}
    mp3 = quality.startswith("mp3")
    kbps = quality.split("-")[1] if "-" in quality else "320"
    target = resolve_folder(folder)
    ensure_tools(control)
    started = time.time() - 2
    created = set()

    def hook(d):
        control.checkpoint()
        if d["status"] == "downloading":
            for key in ("tmpfilename", "filename"):
                if d.get(key):
                    created.add(d[key])
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                pct = round(d.get("downloaded_bytes", 0) * 100 / total, 1)
                if abs(pct - state["last"]) >= 1 or pct >= 100:
                    state["last"] = pct
                    send({"type": "progress", "percent": pct})

    def pp_hook(d):
        control.checkpoint()

    opts = {
        "format": "ba/b" if mp3 else fmt(quality),
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(target, "%(title)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "postprocessor_hooks": [pp_hook],
        "js_runtimes": tools.js_runtimes() or {"deno": {}, "node": {}},
        "windowsfilenames": True,
        "no_color": True,
        "retries": 5,
        "fragment_retries": 5,
        "http_chunk_size": 10485760,
    }
    if mp3:
        opts["writethumbnail"] = True
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": kbps},
            {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"},
            {"key": "FFmpegMetadata"},
            {"key": "EmbedThumbnail"},
        ]
    ff = tools.ffmpeg_dir()
    if ff:
        opts["ffmpeg_location"] = ff

    last = None
    for clients in CLIENTS:
        run = dict(opts)
        if clients:
            run["extractor_args"] = {"youtube": {"player_client": clients}}
            run["continuedl"] = False
        try:
            with yt_dlp.YoutubeDL(run) as ydl:
                info = ydl.extract_info(url, download=False)
                control.checkpoint()
                send({"type": "info", "title": info.get("title", url)})
                base = os.path.splitext(ydl.prepare_filename(info))[0]
                created.update(base + ext for ext in (".webp", ".jpg", ".png", ".mp3", ".mp4", ".m4a", ".webm", ".temp.mp4"))
                ydl.process_ie_result(info, download=True)
                path = info.get("requested_downloads", [{}])[0].get("filepath") or ydl.prepare_filename(info)
                if mp3:
                    path = os.path.splitext(path)[0] + ".mp3"
                send({"type": "done", "file": os.path.basename(path), "path": path})
                return
        except Cancelled:
            remove_created(created, started)
            raise
        except yt_dlp.utils.DownloadError as e:
            last = e
            if "403" not in str(e):
                raise
            send({"type": "progress", "percent": 0})
    raise last


def main():
    msg = receive()
    if not msg:
        return
    if msg.get("type") == "pick":
        pick_folder(msg.get("folder"), msg.get("title"))
        return
    if msg.get("type") == "reveal":
        reveal(msg.get("path"))
        return
    if msg.get("type") == "ping":
        try:
            ping()
        except RuntimeError:
            pass
        return
    if msg.get("type") == "update":
        try:
            update(msg.get("version", "0"))
        except Exception as e:
            send({"type": "error", "message": f"No se pudo actualizar: {ANSI.sub('', str(e))[:200]}"})
        return
    control = Control()
    threading.Thread(target=control.listen, daemon=True).start()
    try:
        quality = msg.get("quality", "720")
        if quality == "mp3":
            quality = "mp3-320"
        download(msg["url"], quality, msg.get("folder"), control)
    except Cancelled:
        send({"type": "cancelled"})
    except Exception as e:
        msg = ANSI.sub("", str(e)).replace("ERROR: ", "")
        if "403" in msg:
            msg = "YouTube bloqueó la descarga (403). Actualiza yt-dlp o intenta de nuevo en un rato."
        send({"type": "error", "message": msg[:300]})


if __name__ == "__main__":
    try:
        main()
    finally:
        with SEND_LOCK:
            out.flush()
        sys.stderr.flush()
        os._exit(0)
