import os
import shutil

HOST = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HOST)
TOOLS = os.path.join(ROOT, "tools")
LINKS = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links")


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
    return os.path.dirname(exe) if exe else None


def js_runtimes():
    found = {}
    deno = _first([shutil.which("deno"), os.path.join(TOOLS, "deno", "deno.exe"), os.path.join(LINKS, "deno.exe")])
    if deno:
        found["deno"] = {"path": deno}
    node = shutil.which("node")
    if node:
        found["node"] = {"path": node}
    return found
