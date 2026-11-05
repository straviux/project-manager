#!/usr/bin/env python3
"""Dry-run smoke test: starts server.py with --dry-run, uploads a tiny
PDF and a tiny .docx with print settings, and checks both jobs reach
'done'. No real printer is touched and no real Office conversion
happens in dry-run mode (that path needs Windows + Office).

Run (cmd):  python test_dry_run.py
"""
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = 8899
BASE = f"http://127.0.0.1:{PORT}"

# A minimal one-page PDF (valid %PDF header, one line of text).
PDF = (b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
       b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
       b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
       b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
       b"4 0 obj << /Length 44 >> stream\nBT /F1 24 Tf 100 700 Td "
       b"(Print server test) Tj ET\nendstream endobj\n"
       b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
       b"trailer << /Root 1 0 R /Size 6 >>\n%%EOF\n")


def make_docx():
    """A minimal valid .docx (a ZIP): enough for the server's PK magic
    check and for Word to open. Not a real document test."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                   '</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                   '</Relationships>')
        z.writestr("word/document.xml",
                   '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   '<w:body><w:p><w:r><w:t>Office upload test</w:t></w:r></w:p></w:body></w:document>')
    return buf.getvalue()


def wait_for_server(proc, timeout=15):
    for _ in range(timeout * 2):
        if proc.poll() is not None:
            raise SystemExit(f"Server exited early with code {proc.returncode}.")
        try:
            urllib.request.urlopen(BASE + "/api/status", timeout=2)
            return
        except Exception:
            time.sleep(0.5)
    raise SystemExit("Server did not start within 15 seconds.")


def upload(filename, data, fields=None):
    boundary = "----test" + uuid.uuid4().hex
    parts = []
    for name, value in (fields or {}).items():
        parts.append((f"--{boundary}\r\n"
                      f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                      f"{value}\r\n").encode())
    parts.append((f"--{boundary}\r\n"
                  f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                  "Content-Type: application/octet-stream\r\n\r\n").encode())
    parts.append(data)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        BASE + "/api/jobs", data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def wait_done(job_id, timeout=20):
    for _ in range(timeout * 2):
        with urllib.request.urlopen(BASE + "/api/jobs", timeout=5) as resp:
            jobs = json.loads(resp.read())
        current = next(j for j in jobs if j["id"] == job_id)
        if current["status"] in ("done", "failed"):
            return current
        time.sleep(0.5)
    raise SystemExit(f"Job {job_id} did not finish in time: {current}")


def main():
    env = dict(os.environ, PRINT_SERVER_DRY_RUN="1")
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--port", str(PORT)],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        wait_for_server(proc)

        # 1. PDF, default settings.
        status, job = upload("test.pdf", PDF, {"sender": "test", "copies": "1"})
        assert status == 201, job
        assert job["status"] == "queued", job
        assert job["settings"] == {"orientation": "auto", "paper": "auto",
                                   "color": "color", "scaling": "fit"}, job
        done = wait_done(job["id"])
        assert done["status"] == "done", done
        print(f"PDF job {job['id']} -> done.")

        # 2. .docx with print settings (landscape, A4, grayscale, fit).
        status, job = upload("test.docx", make_docx(), {
            "sender": "test", "copies": "1",
            "orientation": "landscape", "paper": "A4",
            "color": "monochrome", "scaling": "fit"})
        assert status == 201, job
        assert job["source_ext"] == "docx", job
        assert job["settings"] == {"orientation": "landscape", "paper": "A4",
                                   "color": "monochrome", "scaling": "fit"}, job
        done = wait_done(job["id"])
        assert done["status"] == "done", done
        print(f"DOCX job {job['id']} -> done (settings stored: {done['settings']}).")

        # 3. A .txt file must be rejected, not queued.
        status, body = upload("notes.txt", b"hello", {})
        assert status == 400, (status, body)
        assert "not accepted" in body["error"], body
        print("TXT upload correctly rejected.")

        print("DRY-RUN TEST PASSED: PDF + Office upload -> queue -> done, "
              "no printer touched, no real Office conversion.")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
