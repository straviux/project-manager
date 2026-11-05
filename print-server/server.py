#!/usr/bin/env python3
"""
Print server v2 -- share one USB printer (e.g. Epson L3210) on a LAN.

How it works
------------
* Run this on the PC that has the printer plugged in by USB.
* Other PCs/phones on the SAME local network open the host address in a
  browser, upload a PDF or an Office file, and it joins a
  first-in-first-out queue.
* One worker thread prints jobs one at a time, so the printer is never
  given two jobs at once.

Accepted files
--------------
* PDF -- printed as-is.
* Office -- .docx/.doc (Word), .xlsx/.xls (Excel), .pptx/.ppt
  (PowerPoint). The host converts the file to PDF first, then prints
  that PDF. Page settings (orientation, margins, paper size) come
  from the document itself -- set them in Office before uploading;
  the conversion is Office's own PDF export, so what you see in
  Office is what prints. The original file is never modified.
* Anything else is rejected with a plain message naming the
  accepted types.

Conversion backends
-------------------
* Windows: Microsoft Office on the host, driven by convert_office.ps1
  (PowerShell COM, same approach as the project manager's Office
  preview: ExportAsFixedFormat with the real interop enum, SaveAs PDF
  fallback). Word/Excel/PowerPoint open read-only and invisible.
* Linux / macOS: LibreOffice (`soffice --headless --convert-to pdf`)
  if it is installed. Otherwise Office jobs fail with a plain message
  saying so -- there is no online converter and no file ever leaves
  the host.
* Dry run: PRINT_SERVER_DRY_RUN=1 (or --dry-run) pretends conversion
  and printing both succeeded after a short pause.

What it deliberately does NOT do (v2 limits)
--------------------------------------------
* Printing only, not scanning. The L3210 scanner stays on the host PC.
* Per-job print settings (orientation, paper size, colour/grayscale,
  fit-to-page) are print-time overrides chosen on the upload page.
  Margins still come from the document itself -- they cannot be
  changed at print time.
* LAN only. Do NOT expose this port to the internet. An optional PIN
  (PRINT_SERVER_PIN) adds a light gate for an office, it is not a
  substitute for keeping the port off the public internet.

Printing backends
-----------------
* Windows: SumatraPDF (free, portable). Put SumatraPDF.exe next to
  this file, or set SUMATRA_PATH to it. If it is missing, jobs fail
  with an exact message saying so -- the file is left untouched and
  the job stays visible as failed, so you can retry after installing it.
* Linux / macOS: CUPS `lp`. The Epson driver must already be installed
  on the host, and the printer must already print a test page locally.
* Dry run: PRINT_SERVER_DRY_RUN=1 (or --dry-run) pretends every job
  printed successfully after a short pause. Use it to test the web UI
  and queue without wasting paper or ink.

Dependencies: Python 3.9+ standard library only. No pip installs.

Usage (cmd, on the Windows host):
    python server.py
    python server.py --port 8000 --printer "EPSON L3210 Series"

Then on any client on the same network, open:
    http://<host-ip>:8000
The host IP addresses are printed on startup and shown at /api/status.
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FILES_DIR = DATA_DIR / "files"
JOBS_FILE = DATA_DIR / "jobs.json"

DEFAULT_PORT = 8000
MAX_MB_DEFAULT = 100
MAX_COPIES = 20

ACCEPTED_EXTS = {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"}
OFFICE_KINDS = {
    "doc": "word", "docx": "word",
    "xls": "excel", "xlsx": "excel",
    "ppt": "powerpoint", "pptx": "powerpoint",
}
ACCEPTED_LIST = "PDF, Word (.docx/.doc), Excel (.xlsx/.xls), PowerPoint (.pptx/.ppt)"

# Print settings, chosen per job on the upload page. "auto" means: use
# whatever the document (or the host printer's default) says.
# Margins are NOT here: they live in the document and cannot be
# changed at print time.
DEFAULT_SETTINGS = {"orientation": "auto", "paper": "auto",
                    "color": "color", "scaling": "fit"}
SETTING_CHOICES = {
    "orientation": {"auto", "portrait", "landscape"},
    "paper": {"auto", "A4", "A5", "Letter"},
    "color": {"color", "monochrome"},
    "scaling": {"fit", "actual"},
}


def parse_settings(fields):
    settings = dict(DEFAULT_SETTINGS)
    for key, choices in SETTING_CHOICES.items():
        value = (fields.get(key, "") or "").strip()
        if value in choices:
            settings[key] = value
    return settings

# ---------------------------------------------------------------- config

class Config:
    def __init__(self, args):
        self.host = os.environ.get("PRINT_SERVER_HOST", "0.0.0.0")
        self.port = int(os.environ.get("PRINT_SERVER_PORT", args.port or DEFAULT_PORT))
        self.printer = os.environ.get("PRINT_SERVER_PRINTER", args.printer or "")
        self.pin = os.environ.get("PRINT_SERVER_PIN", args.pin or "")
        self.dry_run = bool(os.environ.get("PRINT_SERVER_DRY_RUN", "") == "1" or args.dry_run)
        self.max_bytes = int(os.environ.get("PRINT_SERVER_MAX_MB", MAX_MB_DEFAULT)) * 1024 * 1024

CONFIG = None  # set in main()


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- jobs

jobs = {}          # id -> dict
jobs_lock = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_filename(name):
    name = Path(name or "document.pdf").name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name) or "document.pdf"
    return name[:120]


def save_jobs():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = JOBS_FILE.with_suffix(".tmp")
        with jobs_lock:
            snapshot = list(jobs.values())
        tmp.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
        tmp.replace(JOBS_FILE)
    except Exception as exc:  # persistence must never kill a print job
        log(f"WARNING: could not save jobs.json: {exc}")


def load_jobs():
    if not JOBS_FILE.exists():
        return
    try:
        for item in json.loads(JOBS_FILE.read_text(encoding="utf-8")):
            if item.get("status") in ("printing", "converting"):
                item["status"] = "queued"  # interrupted by a restart: re-queue it
                item["error"] = "Server restarted while printing; re-queued."
            pdf_path = FILES_DIR / f"{item['id']}.pdf"
            ext = item.get("source_ext", "pdf")
            src_path = FILES_DIR / f"{item['id']}_source.{ext}"
            printable = pdf_path.exists() or (
                ext in OFFICE_KINDS and src_path.exists())
            if not printable and item.get("status") == "queued":
                item["status"] = "failed"
                item["error"] = "Print file missing after restart (data/files was deleted)."
            jobs[item["id"]] = item
        log(f"Loaded {len(jobs)} job(s) from previous run.")
    except Exception as exc:
        log(f"WARNING: could not load jobs.json ({exc}); starting with an empty queue.")


def public_job(job):
    return {
        "id": job["id"],
        "filename": job["filename"],
        "source_ext": job.get("source_ext", "pdf"),
        "sender": job.get("sender", ""),
        "copies": job.get("copies", 1),
        "settings": job.get("settings", dict(DEFAULT_SETTINGS)),
        "printer": job.get("printer", ""),
        "status": job["status"],
        "error": job.get("error", ""),
        "created": job["created"],
        "updated": job.get("updated", job["created"]),
    }


# ---------------------------------------------------------------- printers

def list_printers():
    """Return (names, error). Empty names + error text is a diagnostic,
    not a silent empty list: the UI shows the error verbatim."""
    if sys.platform.startswith("win"):
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-Printer | Select-Object -ExpandProperty Name"],
                capture_output=True, text=True, timeout=15,
            )
            names = [line.strip() for line in out.stdout.splitlines() if line.strip()]
            if names:
                return names, ""
            return names, (out.stderr.strip() or
                           "Get-Printer returned no printers. Is the Epson driver "
                           "installed and does the printer show in Windows Settings?")
        except FileNotFoundError:
            return [], "PowerShell was not found on this PC."
        except Exception as exc:
            return [], f"Could not list printers: {exc}"
    # Linux / macOS: CUPS
    try:
        out = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, timeout=10)
        names = []
        for line in out.stdout.splitlines():
            m = re.match(r"printer\s+(\S+)", line)
            if m:
                names.append(m.group(1))
        if names:
            return names, ""
        return names, (out.stderr.strip() or
                       "lpstat returned no printers. Is CUPS running and is the "
                       "Epson driver installed on this host?")
    except FileNotFoundError:
        return [], "lpstat was not found. Is CUPS installed on this host?"
    except Exception as exc:
        return [], f"Could not list printers: {exc}"


def default_printer():
    if CONFIG.printer:
        return CONFIG.printer
    names, _err = list_printers()
    for name in names:
        if "l3210" in name.lower():
            return name
    return names[0] if names else ""


def find_sumatra():
    """Windows PDF-printing helper. Returns a path or ''."""
    candidates = []
    if os.environ.get("SUMATRA_PATH"):
        candidates.append(Path(os.environ["SUMATRA_PATH"]))
    candidates += [BASE_DIR / "SumatraPDF.exe",
                   BASE_DIR / "sumatra" / "SumatraPDF.exe"]
    for cand in candidates:
        if cand.is_file():
            return str(cand)
    found = shutil.which("SumatraPDF.exe") or shutil.which("SumatraPDF")
    return found or ""


def host_ips():
    ips = set()
    try:
        ips.add(socket.gethostbyname(socket.gethostname()))
    except Exception:
        pass
    try:  # UDP "connect" sends nothing; it just picks the LAN interface
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ips.add(sock.getsockname()[0])
        sock.close()
    except Exception:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


# ---------------------------------------------------------------- conversion

def office_converter():
    """Name of the Office->PDF converter available on this host, or ''."""
    if sys.platform.startswith("win"):
        return "Microsoft Office (Windows)"
    if shutil.which("soffice") or shutil.which("libreoffice"):
        return "LibreOffice"
    return ""


def _first_meaningful_line(text):
    # PowerShell formats a failure as the real message first, then
    # lines like "    + CategoryInfo ..." and "    + FullyQualifiedErrorId
    # : RuntimeException". The last line is useless; take the first
    # meaningful one instead, so the real cause is what the user sees.
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("+"):
            return line
    return ""


def convert_to_pdf(job):
    """Convert an Office job's source file to <id>.pdf.
    Returns '' on success, else an exact error string naming the step
    that failed. A PDF job never reaches this function."""
    ext = job.get("source_ext", "")
    kind = OFFICE_KINDS.get(ext, "")
    src = FILES_DIR / f"{job['id']}_source.{ext}"
    dest = FILES_DIR / f"{job['id']}.pdf"
    if dest.exists() and dest.stat().st_size > 0:
        return ""  # already converted (e.g. after a restart mid-print)
    if not src.exists():
        return f"Office source file not found: {src} (was data/files deleted?)"
    if CONFIG.dry_run:
        log(f"[dry-run] would convert {job['filename']} ({kind}) to PDF")
        time.sleep(0.5)
        return ""

    if sys.platform.startswith("win"):
        script = BASE_DIR / "convert_office.ps1"
        if not script.is_file():
            return ("convert_office.ps1 is missing next to server.py, so "
                    "Office files cannot be converted on this host.")
        cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
               "-File", str(script), "-InputPath", str(src),
               "-OutputPath", str(dest), "-Kind", kind]
        log(f"Converting with Microsoft Office: {' '.join(cmd)}")
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except FileNotFoundError:
            return "PowerShell was not found on this PC."
        except subprocess.TimeoutExpired:
            return ("Microsoft Office conversion timed out after 600s: "
                    f"{' '.join(cmd)}")
        if out.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
            if dest.exists():
                dest.unlink(missing_ok=True)
            detail = _first_meaningful_line(out.stderr) or \
                _first_meaningful_line(out.stdout)
            if detail:
                return (f"Microsoft Office could not convert this file: {detail} "
                        "Check that Office is installed, the file opens in its "
                        "own app, and it is not password-protected or locked.")
            return ("Microsoft Office could not convert this file. Check that "
                    "Office is installed, then open the file in its own app.")
        return ""

    # Linux / macOS: LibreOffice, if present.
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return ("Office conversion needs Microsoft Office on a Windows host, "
                "or LibreOffice on this host. Neither was found, so this "
                "Office file cannot be converted here. Upload a PDF instead.")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [soffice, "--headless", "--convert-to", "pdf",
               "--outdir", tmp, str(src)]
        log(f"Converting with LibreOffice: {' '.join(cmd)}")
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            return ("LibreOffice conversion timed out after 600s: "
                    f"{' '.join(cmd)}")
        made = Path(tmp) / (src.stem + ".pdf")
        if out.returncode != 0 or not made.exists():
            # LibreOffice prints warnings (e.g. javaldx) to stderr even
            # when they are not the cause, so prefer a line that actually
            # says "error"; fall back to the last meaningful line, which
            # for soffice is usually the real failure, not the first.
            lines = [l.strip() for l in (out.stderr + "\n" + out.stdout).splitlines()
                     if l.strip() and not l.strip().startswith("+")]
            detail = next((l for l in lines if "error" in l.lower()), "")
            if not detail:
                detail = next((l for l in reversed(lines)
                               if not l.lower().startswith("warning:")), "")
            return (f"LibreOffice could not convert this file: {detail or 'no output produced'}")
        shutil.move(str(made), str(dest))
    return ""


# ---------------------------------------------------------------- printing

def run_print(job):
    """Print one job. Returns '' on success, else an exact error string
    that names the command and the step that failed."""
    printer = job.get("printer", "")
    copies = max(1, min(MAX_COPIES, int(job.get("copies", 1))))
    settings = {**DEFAULT_SETTINGS, **job.get("settings", {})}
    path = FILES_DIR / f"{job['id']}.pdf"

    if CONFIG.dry_run:
        log(f"[dry-run] would print {job['filename']} x{copies} "
            f"to printer {printer!r} with settings {settings}")
        time.sleep(1)
        return ""

    if not path.exists():
        return f"Print file not found: {path} (was data/files deleted?)"

    if sys.platform.startswith("win"):
        sumatra = find_sumatra()
        if not sumatra:
            return ("SumatraPDF.exe not found. Download the portable "
                    "SumatraPDF, put SumatraPDF.exe next to server.py "
                    "(or set SUMATRA_PATH to it), then retry this job. "
                    "The original file was not changed.")
        # SumatraPDF -print-settings tokens, verified against its docs:
        # portrait/landscape, paper=A4/Letter/..., color/monochrome,
        # fit/noscale. "auto" for orientation/paper means: leave that
        # token out, so the document/printer default decides.
        tokens = []
        if settings["orientation"] != "auto":
            tokens.append(settings["orientation"])
        if settings["paper"] != "auto":
            tokens.append(f"paper={settings['paper']}")
        tokens.append("monochrome" if settings["color"] == "monochrome" else "color")
        tokens.append("fit" if settings["scaling"] == "fit" else "noscale")
        for copy_no in range(copies):
            cmd = [sumatra, "-print-to", printer, "-print-settings",
                   ",".join(tokens), str(path)] if printer \
                else [sumatra, "-print-to-default", "-print-settings",
                      ",".join(tokens), str(path)]
            log(f"Printing copy {copy_no + 1}/{copies}: {' '.join(cmd)}")
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            except subprocess.TimeoutExpired:
                return (f"Printing timed out after 300s running: "
                        f"{' '.join(cmd)}")
            if out.returncode != 0:
                detail = (out.stderr.strip() or out.stdout.strip() or
                          f"exit code {out.returncode}")
                return (f"SumatraPDF failed (copy {copy_no + 1}/{copies}): "
                        f"{' '.join(cmd)} -> {detail}")
        return ""

    # Linux / macOS via CUPS. orientation-requested: 3 = portrait,
    # 4 = landscape. Media/colour/scaling are standard CUPS options.
    lp_opts = []
    if settings["orientation"] == "portrait":
        lp_opts += ["-o", "orientation-requested=3"]
    elif settings["orientation"] == "landscape":
        lp_opts += ["-o", "orientation-requested=4"]
    if settings["paper"] != "auto":
        lp_opts += ["-o", f"media={settings['paper']}"]
    if settings["color"] == "monochrome":
        lp_opts += ["-o", "ColorModel=Gray"]
    else:
        lp_opts += ["-o", "ColorModel=RGB"]
    if settings["scaling"] == "fit":
        lp_opts += ["-o", "fit-to-page"]
    else:
        lp_opts += ["-o", "scaling=100"]
    for copy_no in range(copies):
        cmd = ["lp", "-n", "1"] + lp_opts + [str(path)]
        if printer:
            cmd = ["lp", "-d", printer, "-n", "1"] + lp_opts + [str(path)]
        log(f"Printing copy {copy_no + 1}/{copies}: {' '.join(cmd)}")
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except FileNotFoundError:
            return ("'lp' was not found. Is CUPS installed on this host?")
        except subprocess.TimeoutExpired:
            return f"Printing timed out after 300s running: {' '.join(cmd)}"
        if out.returncode != 0:
            detail = out.stderr.strip() or f"exit code {out.returncode}"
            return (f"lp failed (copy {copy_no + 1}/{copies}): "
                    f"{' '.join(cmd)} -> {detail}")
    return ""


def worker():
    while True:
        job = None
        with jobs_lock:
            queued = [j for j in jobs.values() if j["status"] == "queued"]
            if queued:
                job = sorted(queued, key=lambda j: j["created"])[0]
                job["status"] = "printing"
                job["updated"] = now_iso()
                job["error"] = ""
        if job is None:
            time.sleep(0.5)
            continue
        save_jobs()
        error = ""
        pdf_path = FILES_DIR / f"{job['id']}.pdf"
        if job.get("source_ext", "pdf") in OFFICE_KINDS and not (
                pdf_path.exists() and pdf_path.stat().st_size > 0):
            with jobs_lock:
                job["status"] = "converting"
                job["updated"] = now_iso()
            save_jobs()
            log(f"Converting job {job['id']} ({job['filename']}) to PDF")
            error = convert_to_pdf(job)
            if not error:
                with jobs_lock:
                    job["status"] = "printing"
                    job["updated"] = now_iso()
                save_jobs()
        if not error:
            log(f"Printing job {job['id']} ({job['filename']})")
            error = run_print(job)
        with jobs_lock:
            job["status"] = "failed" if error else "done"
            job["error"] = error
            job["updated"] = now_iso()
        save_jobs()
        log(f"Job {job['id']} -> {job['status']}"
            + (f": {error}" if error else ""))


# ---------------------------------------------------------------- HTTP

def parse_multipart(body, boundary):
    """Minimal multipart/form-data parser for one upload form.
    Returns (fields, files) where files maps name -> (filename, bytes)."""
    fields, files = {}, {}
    sep = b"--" + boundary
    for part in body.split(sep):
        if not part or part in (b"--", b"--\r\n"):
            continue
        # Remove exactly one CRLF at each end: the one after the boundary
        # and the one before the next boundary. Stripping all of them
        # would also eat the blank line that separates an empty file's
        # headers from its (empty) content, and that part would be lost.
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        if not part or part == b"--":
            continue
        head, sep2, content = part.partition(b"\r\n\r\n")
        if not sep2:
            continue
        disp = ""
        for line in head.decode("utf-8", "replace").split("\r\n"):
            if line.lower().startswith("content-disposition:"):
                disp = line
        name_m = re.search(r'name="([^"]*)"', disp)
        file_m = re.search(r'filename="([^"]*)"', disp)
        if not name_m:
            continue
        name = name_m.group(1)
        if file_m and file_m.group(1):
            files[name] = (file_m.group(1), content)
        else:
            fields[name] = content.decode("utf-8", "replace")
    return fields, files


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep the console readable
        pass

    # -- helpers ------------------------------------------------------
    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, content_type):
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # -- GET ----------------------------------------------------------
    def do_GET(self):
        route = urlparse(self.path).path
        if route in ("/", "/index.html"):
            self.send_file(BASE_DIR / "index.html", "text/html; charset=utf-8")
        elif route == "/api/status":
            names, err = list_printers()
            self.send_json({
                "host": socket.gethostname(),
                "ips": host_ips(),
                "port": CONFIG.port,
                "printers": names,
                "printer_error": err,
                "default_printer": default_printer(),
                "sumatra_found": bool(find_sumatra()) if sys.platform.startswith("win") else None,
                "office_converter": office_converter(),
                "accepted": ACCEPTED_LIST,
                "dry_run": CONFIG.dry_run,
                "pin_required": bool(CONFIG.pin),
            })
        elif route == "/api/jobs":
            with jobs_lock:
                ordered = sorted(jobs.values(), key=lambda j: j["created"], reverse=True)
                self.send_json([public_job(j) for j in ordered])
        elif route == "/api/printers":
            names, err = list_printers()
            self.send_json({"printers": names, "error": err,
                            "default": default_printer()})
        else:
            self.send_json({"error": "Not found"}, 404)

    # -- POST ---------------------------------------------------------
    def do_POST(self):
        route = urlparse(self.path).path
        if route == "/api/jobs":
            self.handle_upload()
        elif route.startswith("/api/jobs/") and route.endswith("/cancel"):
            job_id = route[len("/api/jobs/"):-len("/cancel")]
            with jobs_lock:
                job = jobs.get(job_id)
                if job is None:
                    return self.send_json({"error": "Job not found"}, 404)
                if job["status"] != "queued":
                    return self.send_json(
                        {"error": f"Only a queued job can be cancelled "
                                  f"(this one is {job['status']})."}, 409)
                job["status"] = "cancelled"
                job["updated"] = now_iso()
            save_jobs()
            self.send_json(public_job(job))
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_upload(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self.send_json({"error": "Empty upload."}, 400)
        if length > CONFIG.max_bytes:
            return self.send_json(
                {"error": f"File is over the {CONFIG.max_bytes // (1024 * 1024)} MB limit."}, 413)
        ctype = self.headers.get("Content-Type") or ""
        m = re.search(r"boundary=([^\s;]+)", ctype)
        if not m:
            return self.send_json({"error": "Expected a multipart form upload."}, 400)
        body = self.rfile.read(length)
        fields, files = parse_multipart(body, m.group(1).encode())

        if CONFIG.pin and fields.get("pin", "") != CONFIG.pin:
            return self.send_json({"error": "Wrong or missing PIN."}, 403)
        if "file" not in files:
            return self.send_json({"error": "No file was attached."}, 400)
        orig_name, data = files["file"]
        filename = safe_filename(orig_name)
        ext = Path(filename).suffix.lower().lstrip(".")
        if ext not in ACCEPTED_EXTS:
            return self.send_json(
                {"error": f"That file type is not accepted. Accepted: {ACCEPTED_LIST}."}, 400)
        if ext == "pdf":
            if not data.startswith(b"%PDF"):
                return self.send_json(
                    {"error": "That file is named .pdf but does not look like a PDF."}, 400)
        elif ext in OFFICE_KINDS:
            # Modern Office files are ZIPs (PK), old ones are OLE (\xd0\xcf).
            if not (data.startswith(b"PK\x03\x04") or data.startswith(b"\xd0\xcf\x11\xe0")):
                return self.send_json(
                    {"error": f"That file is named .{ext} but does not look like an Office file."}, 400)

        try:
            copies = max(1, min(MAX_COPIES, int(fields.get("copies", "1") or 1)))
        except ValueError:
            copies = 1
        printer = fields.get("printer", "").strip() or default_printer()

        job_id = uuid.uuid4().hex[:12]
        FILES_DIR.mkdir(parents=True, exist_ok=True)
        if ext == "pdf":
            (FILES_DIR / f"{job_id}.pdf").write_bytes(data)
        else:
            (FILES_DIR / f"{job_id}_source.{ext}").write_bytes(data)
        job = {
            "id": job_id,
            "filename": filename,
            "source_ext": ext,
            "sender": (fields.get("sender", "") or "").strip()[:80],
            "copies": copies,
            "settings": parse_settings(fields),
            "printer": printer,
            "status": "queued",
            "error": "",
            "created": now_iso(),
            "updated": now_iso(),
        }
        with jobs_lock:
            jobs[job_id] = job
        save_jobs()
        log(f"Queued job {job_id} ({job['filename']}, x{copies}, "
            f"{job['settings']}, "
            f"from {job['sender'] or 'unknown'}) -> {printer or '(system default)'}")
        self.send_json(public_job(job), 201)


# ---------------------------------------------------------------- main

def main():
    global CONFIG
    parser = argparse.ArgumentParser(description="LAN print server (PDF, queue, one USB printer)")
    parser.add_argument("--port", type=int, default=0, help="Port to listen on (default 8000)")
    parser.add_argument("--printer", default="", help="Printer name to use by default")
    parser.add_argument("--pin", default="", help="Optional PIN clients must enter")
    parser.add_argument("--dry-run", action="store_true",
                        help="Pretend to print; test the UI without paper/ink")
    args = parser.parse_args()
    CONFIG = Config(args)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    load_jobs()

    threading.Thread(target=worker, daemon=True).start()
    server = ThreadingHTTPServer((CONFIG.host, CONFIG.port), Handler)
    ips = host_ips()
    log("Print server running.")
    log(f"  Host PC : {socket.gethostname()}")
    log(f"  Printer : {default_printer() or '(none found yet -- see /api/status)'}")
    if sys.platform.startswith("win"):
        log(f"  SumatraPDF: {'found' if find_sumatra() else 'NOT FOUND -- see README step 3'}")
        log("  Office converter: Microsoft Office (needed for .docx/.xlsx/.pptx)")
    else:
        log(f"  Office converter: {office_converter() or 'NONE -- Office uploads will fail; see README'}")
    log(f"  Dry run : {'ON -- nothing will actually print' if CONFIG.dry_run else 'off'}")
    log(f"  PIN     : {'required' if CONFIG.pin else 'not set (LAN only)'}")
    log("  Open on any PC/phone on the same network:")
    for ip in ips or ["<this-PC-IP>"]:
        log(f"    http://{ip}:{CONFIG.port}")
    log("  (On the host itself: http://localhost:%d)" % CONFIG.port)
    log("  Press Ctrl+C to stop. Queued jobs are saved and resume on restart.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Stopping.")
        server.shutdown()


if __name__ == "__main__":
    main()
