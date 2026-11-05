# Convert one Office file to PDF with Microsoft Office itself.
# Called by server.py, never by a client directly. Paths reach this
# script as named parameters, not interpolated text, so a file name
# with spaces or quotes cannot break out of it.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File convert_office.ps1 `
#     -InputPath "C:\path\file.docx" -OutputPath "C:\path\file.pdf" -Kind word
#
# Kind is word, excel, or powerpoint. The app is opened read-only and
# invisible, exported to PDF, then quit and released, so no Office
# window pops up and the original file is never modified.
#
# Office ExportAsFixedFormat takes enum parameters. Passing a plain
# int (e.g. PowerPoint's 2 for PDF) fails in PowerShell's COM binder,
# so load the Office interop assembly and pass the real enum value.
# If that is not available, fall back to SaveAs PDF (Word 17,
# PowerPoint 32, Excel 57). Do NOT fall back to reflection
# InvokeMember: it does not fill in the missing optional parameters
# the way PowerShell's own COM call does, and fails with
# DISP_E_TYPEMISMATCH (0x80020005). SaveAs changes the open
# document's target path, but the caller closes without saving
# afterwards, so the original file is untouched.
param([string]$InputPath, [string]$OutputPath, [string]$Kind)
$ErrorActionPreference = 'Stop'

function Export-WordPdf($doc, $out) {
  try {
    Add-Type -AssemblyName Microsoft.Office.Interop.Word -ErrorAction Stop
    $doc.ExportAsFixedFormat($out, [Microsoft.Office.Interop.Word.WdExportFormat]::wdExportFormatPDF)
    return
  } catch {}
  $doc.SaveAs($out, 17)
}
function Export-PowerPointPdf($pres, $out) {
  try {
    Add-Type -AssemblyName Microsoft.Office.Interop.PowerPoint -ErrorAction Stop
    $pres.ExportAsFixedFormat($out, [Microsoft.Office.Interop.PowerPoint.PpFixedFormatType]::ppFixedFormatTypePDF)
    return
  } catch {}
  $pres.SaveAs($out, 32)
}
function Export-ExcelPdf($wb, $out) {
  try {
    Add-Type -AssemblyName Microsoft.Office.Interop.Excel -ErrorAction Stop
    $wb.ExportAsFixedFormat([Microsoft.Office.Interop.Excel.XlFixedFormatType]::xlTypePDF, $out)
    return
  } catch {}
  $wb.SaveAs($out, 57)
}

try {
  if ($Kind -eq 'word') {
    $app = New-Object -ComObject Word.Application
    try {
      $app.Visible = $false
      $doc = $app.Documents.Open($InputPath, $false, $true)
      try { Export-WordPdf $doc $OutputPath } finally { try { $doc.Close($false) } catch {} }
    } finally { try { $app.Quit() } catch {}; try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null } catch {} }
  } elseif ($Kind -eq 'powerpoint') {
    $app = New-Object -ComObject PowerPoint.Application
    try {
      $pres = $app.Presentations.Open($InputPath, $true, $true, $false)
      try { Export-PowerPointPdf $pres $OutputPath } finally { try { $pres.Close() } catch {} }
    } finally { try { $app.Quit() } catch {}; try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null } catch {} }
  } elseif ($Kind -eq 'excel') {
    $app = New-Object -ComObject Excel.Application
    try {
      $app.Visible = $false
      $app.DisplayAlerts = $false
      $wb = $app.Workbooks.Open($InputPath, $false, $true)
      try { Export-ExcelPdf $wb $OutputPath } finally { try { $wb.Close($false) } catch {} }
    } finally { try { $app.Quit() } catch {}; try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null } catch {} }
  } else {
    throw "Unknown Office kind: $Kind"
  }
} finally {
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
