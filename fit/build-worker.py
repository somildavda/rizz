"""Bundle the Journey app into one Cloudflare Worker file: python3 build-worker.py → dist/worker.js"""
import base64, hashlib, json, pathlib

here = pathlib.Path(__file__).parent
TEXT = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/manifest+json"}
NAMES = ["index.html", "kitchen.html", "app.js", "plan.js", "kitchen.js", "style.css", "manifest.json", "sw.js"]
# Build id = hash of the app's files; the app and service worker are stamped with it so
# phones can tell when a newer version is live.
build = hashlib.sha1("".join((here / n).read_text() for n in NAMES).encode()).hexdigest()[:10]
files = {}
for name in NAMES:
    files["/" + name] = [TEXT[pathlib.Path(name).suffix], (here / name).read_text().replace("__BUILD__", build), False]
for icon in sorted((here / "icons").glob("*.png")):
    files["/icons/" + icon.name] = ["image/png", base64.b64encode(icon.read_bytes()).decode(), True]

template = (here / "worker-template.js").read_text()
out = here / "dist" / "worker.js"
out.parent.mkdir(exist_ok=True)
out.write_text(template.replace("__FILES__", json.dumps(files)).replace("__BUILD_ID__", build))
print(f"wrote {out} ({out.stat().st_size // 1024} KB, build {build})")
