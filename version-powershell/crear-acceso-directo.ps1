# Crea el ícono de NezvImage y un acceso directo en el Escritorio.
# Ejecutar una vez (clic derecho > "Ejecutar con PowerShell").
Add-Type -AssemblyName System.Drawing

$app  = Join-Path $PSScriptRoot 'nezvimage.ps1'
$ico  = Join-Path $PSScriptRoot 'nezvimage.ico'

# Dibujar el ícono (256 px, PNG dentro de un .ico)
$n = 256
$b = [Drawing.Bitmap]::new($n, $n)
$g = [Drawing.Graphics]::FromImage($b); $g.SmoothingMode = 'AntiAlias'
$r = $n * 0.2; $gp = [Drawing.Drawing2D.GraphicsPath]::new()
$gp.AddArc(0, 0, $r, $r, 180, 90); $gp.AddArc($n - $r - 1, 0, $r, $r, 270, 90)
$gp.AddArc($n - $r - 1, $n - $r - 1, $r, $r, 0, 90); $gp.AddArc(0, $n - $r - 1, $r, $r, 90, 90); $gp.CloseFigure()
$g.FillPath([Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(0, 120, 212)), $gp)
$g.FillRectangle([Drawing.Brushes]::White, $n * 0.16, $n * 0.22, $n * 0.68, $n * 0.56)
$g.FillEllipse([Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 185, 0)), $n * 0.58, $n * 0.28, $n * 0.14, $n * 0.14)
$pts = [Drawing.PointF[]]@(
    [Drawing.PointF]::new($n * 0.20, $n * 0.74), [Drawing.PointF]::new($n * 0.40, $n * 0.42),
    [Drawing.PointF]::new($n * 0.55, $n * 0.62), [Drawing.PointF]::new($n * 0.65, $n * 0.52),
    [Drawing.PointF]::new($n * 0.80, $n * 0.74))
$g.FillPolygon([Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(0, 90, 160)), $pts)
$g.Dispose()

$png = [IO.MemoryStream]::new(); $b.Save($png, [Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
$bytes = $png.ToArray()
$fs = [IO.File]::Create($ico); $w = [IO.BinaryWriter]::new($fs)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)          # cabecera ICO
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0) # 256x256
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$bytes.Length); $w.Write([uint32]22)
$w.Write($bytes); $w.Close()

# Acceso directo en el Escritorio
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'NezvImage.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$app`""
$s.WorkingDirectory = $PSScriptRoot
$s.IconLocation = "$ico,0"
$s.WindowStyle = 7
$s.Description = 'NezvImage - fotos organizadas por pestañas'
$s.Save()

Write-Host "Listo: acceso directo creado en $lnk"
