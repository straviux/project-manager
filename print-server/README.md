# Office Print Server — v2

Share one USB printer (built for the Epson L3210, which has USB only and
no Wi-Fi or Ethernet) with everyone on the same office network.

* **Host:** the PC with the printer plugged in by USB runs `server.py`.
* **Clients:** any PC or phone on the same network opens the host address
  in a browser and uploads a file. No software to install on clients.
* **Jobs:** first-in, first-out queue, one job at a time, with status
  (queued / converting / printing / done / failed / cancelled) visible
  to everyone.
* **Files:** PDF, or Word (.docx/.doc), Excel (.xlsx/.xls), PowerPoint
  (.pptx/.ppt). Office files are converted to PDF on the host first
  (see "Office files" below), then printed.

## Office files

Upload a Word, Excel or PowerPoint file and the host converts it to
PDF with Microsoft Office itself (PowerShell COM, `convert_office.ps1`,
the same approach as the project manager's Office preview), then
prints that PDF. The original file is never modified; the converted
PDF is kept in `data/files/<job-id>.pdf`.

* **Office must be installed on the Windows host** — Word for .docx/.doc,
  Excel for .xlsx/.xls, PowerPoint for .pptx/.ppt. On Linux/macOS the
  fallback is LibreOffice (`soffice`), if installed. There is no online
  converter and no file ever leaves the host.
* **Page settings come from the document.** Set orientation, margins
  and paper size in Office before uploading (Layout → Page Setup).
  Conversion is Office's own PDF export, so what you see in Office is
  what prints. For Excel, also check the print area and fit-to-page
  before uploading, or a wide sheet can split across pages.
* **Conversion takes a few seconds** and shows as `converting` in the
  queue. If it fails, the job's error text names the exact Office/COM
  error — send that text back. Common causes: Office not installed,
  the file is password-protected or locked, or the file does not open
  in its own app.

## Print settings (on the upload page)

These are print-time overrides, applied when the PDF is printed —
they do not change the document, and margins are not among them
(margins live in the document, see above):

* **Orientation:** Auto (as in the document), Portrait, Landscape.
* **Paper size:** Auto (as in the document), A4, A5, Letter.
* **Colour:** Colour, or Black & white (grayscale).
* **Scaling:** Fit to page (default), or Actual size (no scaling).

On Windows they are passed to SumatraPDF as `-print-settings`
(portrait/landscape, `paper=A4`, color/monochrome, fit/noscale);
on Linux/macOS they become CUPS options (orientation-requested,
media, ColorModel, fit-to-page/scaling).

## What is verified, and what is not

Verified here (Linux, dry-run mode): the server starts, the web page
loads, a PDF uploads, the queue records it, and the job ends as `done`
in dry-run mode. The dry-run test also uploads a .docx with print
settings (landscape, A4, grayscale, fit) and checks it reaches `done`
with those settings stored. See "Test without a printer" below.

**Not yet verified — needs runs on the Windows host:**
1. Printing a real page on the L3210 via SumatraPDF.
2. A real .docx converting via Microsoft Office and then printing
   (the COM script is the same approach as the project manager's
   Office preview, but it has never run on this host's Office yet).
Both are single-step paths, so one run points at one cause. If
either fails, the job's error text in the web UI names the exact
command and failure — send that text back and the fix will follow
from it, not from another guess. Print settings are also untested
on a real printer: the SumatraPDF tokens used are verified against
its docs, but the first real landscape/grayscale page is the proof.

## Setup on the Windows host (cmd)

All commands below are for Command Prompt (cmd), not PowerShell.

### 1. Make the printer work locally first

Plug the L3210 into the host PC by USB, install the Epson L3210 driver
from Epson's site, and print a Windows test page. If a test page does
not print locally, the server cannot fix that — fix the driver/USB
first, then come back here.

### 2. Check Python

```
python --version
```

You need Python 3.9 or newer. No pip packages are needed — the server
uses the standard library only. If Python is not installed, install it
from python.org and tick "Add python.exe to PATH" during setup.

### 3. Install SumatraPDF (the PDF-printing helper)

Windows has no reliable built-in way to silently print a PDF from a
script, so v1 uses SumatraPDF (free, portable):

1. Download the portable SumatraPDF from sumatrapdfreader.org.
2. Put `SumatraPDF.exe` in the same folder as `server.py`.
   (Alternative: set an environment variable pointing at it:
   `set SUMATRA_PATH=C:\path\to\SumatraPDF.exe` — no quotes around
   the value in cmd.)

If this step is skipped, jobs will fail with an exact message saying
SumatraPDF was not found. The uploaded file is kept, so you can retry
after installing it.

### 4. Start the server

```
cd /d C:\path\to\print-server
python server.py
```

On first run Windows Firewall will ask whether to allow Python on the
network — choose **Allow** (private network). Without that, other PCs
cannot reach it.

The server prints the addresses to open, for example:

```
http://192.168.1.42:8000
```

Open that address from any office PC or phone on the same network.
On the host itself, `http://localhost:8000` also works.

To stop the server, press Ctrl+C in its window. Queued jobs are saved
in the `data` folder and resume when the server restarts.

### 5. Optional: set a PIN and a fixed printer

```
set PRINT_SERVER_PIN=1234
python server.py --printer "EPSON L3210 Series"
```

The PIN is entered on the upload page. Without a PIN, anyone on the
office network who knows the address can print — that is fine on a
trusted office LAN, but do not forward this port through the router
to the internet.

Other options: `python server.py --port 8080` to change the port,
`--dry-run` to test without printing (below).

For a double-click start, use `start.bat` in this folder instead of
typing the commands. It keeps the window open so you can see errors.

## Test without a printer

```
python test_dry_run.py
```

This starts the server in dry-run mode on a test port, uploads a
small generated PDF, then a small generated .docx with print settings
(landscape, A4, grayscale, fit), and checks both jobs reach `done`.
Nothing is sent to a real printer, and no real Office conversion
happens in dry-run mode. It needs Python only.

## If a job fails

Open the queue in the browser and read the job's error text — it is
deliberately verbose. The common cases:

* **"SumatraPDF.exe not found"** — do step 3 above, then re-upload.
* **"Microsoft Office could not convert this file: …"** — Office is
  not installed on the host, the file is password-protected or locked,
  or it does not open in its own app. The exact detail after the colon
  is the cause. Uploading the same file as a PDF (Save As PDF in
  Office) still works while this is sorted out.
* **"Get-Printer returned no printers"** — the Epson driver is not
  installed, or the printer is not showing in Windows Settings.
* **A SumatraPDF error naming the printer** — the printer name in
  the dropdown does not match Windows' name for it. Pick the exact
  name from the dropdown, or start with
  `--printer "EPSON L3210 Series"` (check the exact name in
  Settings → Printers first).
* **Clients cannot open the page** — the host and client are not on
  the same network, the host PC is asleep, the server window was
  closed, or Windows Firewall blocked Python (step 4).

## Files in this folder

* `server.py` — the whole server (queue, web API, conversion and printing backends).
* `convert_office.ps1` — the fixed PowerShell script server.py runs to
  convert Office files to PDF with Microsoft Office on Windows.
* `index.html` — the client web page (no build step, no framework).
* `start.bat` — double-click starter for the Windows host (cmd).
* `test-print.pdf` — a one-page test file to upload for the first real
  print on the L3210 (it says "Print server test" at the top). It was
  checked here in dry-run mode: upload -> queued -> done.
* `test_dry_run.py` — dry-run smoke test, no printer needed.
* `data/` — created on first run: uploaded PDFs and `jobs.json`.

## Limits of v2 (honest list)

* Printing only. Scanning from the L3210 still happens on the host PC.
* One printer, one queue. No per-user quotas, copies up to 20.
  Margins come from the document; print settings cover orientation,
  paper size, colour/grayscale and fit-to-page only.
* No internet access. LAN only, by design. The optional PIN is a
  light office gate, not internet-grade security.
* The host PC must stay on and awake while people print.
