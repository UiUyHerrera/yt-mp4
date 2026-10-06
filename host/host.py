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


SILENCE_FILTER = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:detection=peak"
FACEBOOK_STATS = re.compile(r"^[\d.,]+\s*[KMB]?\s+(views|reproducciones)\b[^|]*\|\s*", re.I)
LOGIN_WALL = re.compile(r"login required|log ?in|logged.in|rate.?limit|not available|private|empty media|Cannot parse data", re.I)
NO_AUDIO = "Este video no tiene sonido, así que no se puede bajar como MP3."


def format_options(quality, mp3):
    if mp3:
        return {"format": "ba/b"}
    if quality == "best":
        return {"format": "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b"}
    return {"format": "bv*[vcodec!^=av01]+ba/bv*+ba/b", "format_sort": [f"res:{int(quality)}", "vcodec:h264", "acodec:aac"]}


def nice_title(info, url):
    title = (info.get("title") or "").strip()
    title = FACEBOOK_STATS.sub("", title).strip()
    return title or info.get("id") or url


def friendly_error(text, url):
    if "403" in text:
        return "YouTube bloqueó la descarga (403). Actualiza yt-dlp o intenta de nuevo en un rato."
    site = "Instagram" if "instagram.com" in url else "Facebook" if ("facebook.com" in url or "fb.watch" in url) else None
    if site and LOGIN_WALL.search(text):
        return f"{site} no dejó bajar este video: puede ser privado o pide iniciar sesión. Si es público, prueba de nuevo en un rato."
    if site and "no video" in text.lower():
        return f"Esta publicación de {site} no tiene video."
    return text


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
    user32.ShowWindow(hwnd, 5)
    focus_window(hwnd)
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


FIND_EXPLORER = r"""
$p = $env:MPEASY_REVEAL
$dir = [IO.Path]::GetDirectoryName($p).TrimEnd('\')
$name = [IO.Path]::GetFileName($p)
$shell = New-Object -ComObject Shell.Application
foreach ($attempt in 1..3) {
  $busy = $false
  foreach ($w in @($shell.Windows())) {
    try { $f = $w.Document.Folder.Self.Path } catch { $busy = $true; continue }
    if ($f -and $f.TrimEnd('\') -ieq $dir) {
      $item = $w.Document.Folder.ParseName($name)
      if ($item) { $w.Document.SelectItem($item, 29) }
      [Console]::Out.Write($w.HWND)
      exit 0
    }
  }
  if (-not $busy) { exit 1 }
  Start-Sleep -Milliseconds 300
}
exit 1
"""


def open_explorer_window(path):
    try:
        found = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", FIND_EXPLORER],
            env={**os.environ, "MPEASY_REVEAL": path},
            capture_output=True,
            text=True,
            timeout=15,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if found.returncode != 0 or not found.stdout.strip().isdigit():
        return None
    return int(found.stdout.strip())


def focus_window(hwnd):
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.c_void_p]
    user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SwitchToThisWindow.argtypes = [wintypes.HWND, wintypes.BOOL]
    for name in ("IsIconic", "BringWindowToTop", "SetForegroundWindow"):
        getattr(user32, name).argtypes = [wintypes.HWND]
    current = ctypes.windll.kernel32.GetCurrentThreadId()
    owner = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
    attached = bool(owner) and owner != current and user32.AttachThreadInput(current, owner, True)
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    if attached:
        user32.AttachThreadInput(current, owner, False)
    if user32.GetForegroundWindow() != hwnd:
        user32.SwitchToThisWindow(hwnd, True)


def reveal(path):
    path = os.path.normpath(path or "")
    if not path or not os.path.isfile(path):
        send({"type": "error", "message": "El archivo ya no está en esa carpeta."})
        return
    hwnd = open_explorer_window(path)
    if hwnd:
        focus_window(hwnd)
    else:
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


def download(url, quality, folder, control, trim=False):
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
        **format_options(quality, mp3),
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
        if trim:
            opts["postprocessor_args"] = {"extractaudio": ["-af", SILENCE_FILTER]}
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
                formats = info.get("formats") or []
                if mp3 and formats and all(f.get("acodec") == "none" for f in formats):
                    raise RuntimeError(NO_AUDIO)
                send({"type": "info", "title": nice_title(info, url)})
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
            if trim and "Postprocessing" in str(e):
                remove_created(created, started)
                return download(url, quality, folder, control, False)
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
        download(msg["url"], quality, msg.get("folder"), control, bool(msg.get("trim")))
    except Cancelled:
        send({"type": "cancelled"})
    except Exception as e:
        text = ANSI.sub("", str(e)).replace("ERROR: ", "")
        send({"type": "error", "message": friendly_error(text, msg.get("url", ""))[:300]})


if __name__ == "__main__":
    try:
        main()
    finally:
        with SEND_LOCK:
            out.flush()
        sys.stderr.flush()
        os._exit(0)
