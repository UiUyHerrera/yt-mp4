import json
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
FILES = ["install.bat", "update.json", "host/host.py", "host/setup.py", "host/tools.py"]


def main():
    with open(os.path.join(ROOT, "extension", "manifest.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]
    files = list(FILES)
    for base, _, names in os.walk(os.path.join(ROOT, "extension")):
        for name in names:
            files.append(os.path.relpath(os.path.join(base, name), ROOT).replace(os.sep, "/"))
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    out = os.path.join(ROOT, "dist", "yt-mp4.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in sorted(files):
            z.write(os.path.join(ROOT, *rel.split("/")), f"yt-mp4/{rel}")
    print(f"v{version} -> {out}")


if __name__ == "__main__":
    main()
