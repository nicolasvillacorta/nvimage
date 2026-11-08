# NezvImage - visor de fotos organizado por pestañas
# Cada pestaña es una carpeta dentro de "Fotos". Las fotos agregadas se copian ahí.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

# Nitidez en pantallas con escala (125%, 150%...)
try {
    $asm = [AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('NezvDpi'), 'Run')
    $tb0 = $asm.DefineDynamicModule('NezvDpi').DefineType('NezvDpi.Native', 'Public, Class')
    [void]$tb0.DefinePInvokeMethod('SetProcessDPIAware', 'user32.dll', 'Public, Static, PinvokeImpl',
        'Standard', [bool], [Type[]]@(), 'Winapi', 'Auto')
    [void]$tb0.DefinePInvokeMethod('ShowWindow', 'user32.dll', 'Public, Static, PinvokeImpl',
        'Standard', [bool], [Type[]]@([IntPtr], [int]), 'Winapi', 'Auto')
    $Native = $tb0.CreateType()
    [void]$Native::SetProcessDPIAware()
} catch { $Native = $null }

[Windows.Forms.Application]::EnableVisualStyles()

$g0 = [Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $S = $g0.DpiX / 96; $g0.Dispose()
function Px([double]$v) { [int][Math]::Round($v * $S) }

# ---------------------------------------------------------------- Datos
$AppDir     = $PSScriptRoot
$Root       = Join-Path $AppDir 'Fotos'
$CacheDir   = Join-Path $AppDir '.miniaturas'
$ConfigPath = Join-Path $AppDir 'config.json'
$Exts       = @('.jpg', '.jpeg', '.jfif', '.png', '.bmp', '.gif', '.tif', '.tiff')
$ThumbMax   = Px 320

$firstRun = -not (Test-Path -LiteralPath $ConfigPath)
foreach ($d in $Root, $CacheDir) {
    if (-not (Test-Path -LiteralPath $d)) { [void](New-Item -ItemType Directory -Path $d) }
}
try { (Get-Item -LiteralPath $CacheDir -Force).Attributes = 'Hidden, Directory' } catch {}
if ($firstRun -and -not (Get-ChildItem -LiteralPath $Root -Directory)) {
    [void](New-Item -ItemType Directory -Path (Join-Path $Root 'Ventas'))
}

$Config = [ordered]@{ ultimaPestana = ''; tamano = 200; orden = @() }
if (-not $firstRun) {
    try {
        $j = [IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
        if ($j.ultimaPestana) { $Config.ultimaPestana = [string]$j.ultimaPestana }
        if ($j.tamano) { $Config.tamano = [Math]::Min(320, [Math]::Max(100, [int]$j.tamano)) }
        if ($j.orden) { $Config.orden = @($j.orden) }
    } catch {}
}

function Save-Config {
    try {
        $Config.orden = @($tabs.TabPages | ForEach-Object { $_.Text })
        if ($tabs.SelectedTab) { $Config.ultimaPestana = $tabs.SelectedTab.Text }
        [IO.File]::WriteAllText($ConfigPath, ($Config | ConvertTo-Json))
    } catch {}
}

# ---------------------------------------------------------------- Imágenes
function Load-Bitmap([string]$Path, [int]$MaxSize = 0) {
    $ms = [IO.MemoryStream]::new([IO.File]::ReadAllBytes($Path))
    try {
        $src = [Drawing.Image]::FromStream($ms, $true, $false)
        try {
            $w = $src.Width; $h = $src.Height
            if ($MaxSize -gt 0) {
                $k = [Math]::Min(1.0, [Math]::Min($MaxSize / $w, $MaxSize / $h))
                $w = [Math]::Max(1, [int]($w * $k)); $h = [Math]::Max(1, [int]($h * $k))
            }
            $bmp = [Drawing.Bitmap]::new($w, $h)
            $g = [Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = 'HighQualityBicubic'
            $g.PixelOffsetMode = 'HighQuality'
            $g.DrawImage($src, 0, 0, $w, $h)
            $g.Dispose()
            # Respetar la orientación de las fotos del celular (EXIF)
            if ($src.PropertyIdList -contains 274) {
                switch ([int]$src.GetPropertyItem(274).Value[0]) {
                    3 { $bmp.RotateFlip([Drawing.RotateFlipType]::Rotate180FlipNone) }
                    6 { $bmp.RotateFlip([Drawing.RotateFlipType]::Rotate90FlipNone) }
                    8 { $bmp.RotateFlip([Drawing.RotateFlipType]::Rotate270FlipNone) }
                }
            }
            return $bmp
        } finally { $src.Dispose() }
    } finally { $ms.Dispose() }
}

$Md5 = [Security.Cryptography.MD5]::Create()
function Get-Thumb([IO.FileInfo]$File) {
    $key = '{0}|{1}|{2}|{3}' -f $File.FullName.ToLowerInvariant(), $File.Length, $File.LastWriteTimeUtc.Ticks, $ThumbMax
    $hash = [BitConverter]::ToString($Md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))).Replace('-', '')
    $cp = Join-Path $CacheDir "$hash.png"
    if (Test-Path -LiteralPath $cp) { try { return (Load-Bitmap $cp) } catch {} }
    $t = Load-Bitmap $File.FullName $ThumbMax
    try { $t.Save($cp, [Drawing.Imaging.ImageFormat]::Png) } catch {}
    return $t
}

function Get-ImageFiles([string]$Dir) {
    @(Get-ChildItem -LiteralPath $Dir -File -ErrorAction SilentlyContinue |
        Where-Object { $Exts -contains $_.Extension.ToLowerInvariant() } |
        Sort-Object CreationTime, Name)
}

function Get-UniquePath([string]$Dir, [string]$Name) {
    $base = [IO.Path]::GetFileNameWithoutExtension($Name); $ext = [IO.Path]::GetExtension($Name)
    $p = Join-Path $Dir $Name; $i = 2
    while (Test-Path -LiteralPath $p) { $p = Join-Path $Dir ('{0} ({1}){2}' -f $base, $i, $ext); $i++ }
    $p
}

function New-AppBitmap([int]$n) {
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
    $g.Dispose(); $b
}

# ---------------------------------------------------------------- Estilo
$ColBack   = [Drawing.Color]::FromArgb(243, 243, 243)
$ColCard   = [Drawing.Color]::White
$ColSel    = [Drawing.Color]::FromArgb(204, 228, 247)
$AppIcon   = [Drawing.Icon]::FromHandle((New-AppBitmap 64).GetHicon())
$script:Busy = $false
$script:Closing = $false
$script:LoadToken = 0

function Show-Msg([string]$Text, [string]$Icon = 'Information') {
    [void][Windows.Forms.MessageBox]::Show($form, $Text, 'NezvImage', 'OK', $Icon)
}
function Ask-YesNo([string]$Text) {
    [Windows.Forms.MessageBox]::Show($form, $Text, 'NezvImage', 'YesNo', 'Warning') -eq 'Yes'
}

function Ask-Text([string]$Title, [string]$Prompt, [string]$Default = '') {
    $d = [Windows.Forms.Form]::new()
    $d.Text = $Title; $d.Font = $form.Font; $d.Icon = $AppIcon
    $d.FormBorderStyle = 'FixedDialog'; $d.MinimizeBox = $false; $d.MaximizeBox = $false
    $d.StartPosition = 'CenterParent'; $d.ShowInTaskbar = $false
    $d.ClientSize = [Drawing.Size]::new((Px 420), (Px 140))
    $l = [Windows.Forms.Label]::new(); $l.Text = $Prompt; $l.AutoSize = $true
    $l.Location = [Drawing.Point]::new((Px 14), (Px 14))
    $t = [Windows.Forms.TextBox]::new(); $t.Text = $Default
    $t.Location = [Drawing.Point]::new((Px 14), (Px 44)); $t.Width = Px 392
    $ok = [Windows.Forms.Button]::new(); $ok.Text = 'Aceptar'; $ok.DialogResult = 'OK'
    $ok.Bounds = [Drawing.Rectangle]::new((Px 216), (Px 92), (Px 92), (Px 32))
    $ca = [Windows.Forms.Button]::new(); $ca.Text = 'Cancelar'; $ca.DialogResult = 'Cancel'
    $ca.Bounds = [Drawing.Rectangle]::new((Px 314), (Px 92), (Px 92), (Px 32))
    $d.Controls.AddRange(@($l, $t, $ok, $ca)); $d.AcceptButton = $ok; $d.CancelButton = $ca
    $d.add_Shown({ $t.SelectAll(); $t.Focus() })
    $r = if ($d.ShowDialog($form) -eq 'OK') { $t.Text.Trim() } else { $null }
    $d.Dispose(); $r
}

# ---------------------------------------------------------------- Ventana
$form = [Windows.Forms.Form]::new()
$form.Text = 'NezvImage'
$form.Icon = $AppIcon
$form.Font = [Drawing.Font]::new('Segoe UI', 10)
$form.Size = [Drawing.Size]::new((Px 1200), (Px 800))
$form.MinimumSize = [Drawing.Size]::new((Px 700), (Px 450))
$form.StartPosition = 'CenterScreen'
$form.BackColor = $ColBack
$form.KeyPreview = $true

$tool = [Windows.Forms.ToolStrip]::new()
$tool.GripStyle = 'Hidden'
$tool.Padding = [Windows.Forms.Padding]::new((Px 6), (Px 4), (Px 6), (Px 4))
$tool.BackColor = [Drawing.Color]::White
$tool.RenderMode = 'System'

function Add-ToolButton([string]$Text, [string]$Tip, [scriptblock]$Action) {
    $b = [Windows.Forms.ToolStripButton]::new($Text)
    $b.ToolTipText = $Tip; $b.add_Click($Action)
    $b.Padding = [Windows.Forms.Padding]::new((Px 4), 0, (Px 4), 0)
    [void]$tool.Items.Add($b); $b
}
function Add-ToolSep { [void]$tool.Items.Add([Windows.Forms.ToolStripSeparator]::new()) }

$status = [Windows.Forms.StatusStrip]::new()
$statusLbl = [Windows.Forms.ToolStripStatusLabel]::new()
$statusLbl.Spring = $true; $statusLbl.TextAlign = 'MiddleLeft'
[void]$status.Items.Add($statusLbl)

$tabs = [Windows.Forms.TabControl]::new()
$tabs.Dock = 'Fill'
$tabs.Padding = [Drawing.Point]::new((Px 14), (Px 6))

$tip = [Windows.Forms.ToolTip]::new()

function Update-Status {
    $p = $tabs.SelectedTab
    if (-not $p) { $statusLbl.Text = 'No hay pestañas. Crea una con "Nueva pestaña".'; return }
    $n = $p.Tag.Count
    $sel = @(Get-SelectedPaths $p).Count
    $txt = '{0}   ·   {1} foto{2}' -f $p.Text, $n, $(if ($n -eq 1) { '' } else { 's' })
    if ($sel -gt 0) { $txt += '   ·   {0} seleccionada{1}' -f $sel, $(if ($sel -eq 1) { '' } else { 's' }) }
    $statusLbl.Text = $txt + '        (Doble clic en el nombre de la pestaña para renombrarla · Ctrl+V pega imágenes)'
}

# ---------------------------------------------------------------- Arrastrar y soltar
$onDragEnter = {
    param($s, $e)
    if ($e.Data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)) { $e.Effect = 'Copy' }
}
$onDragDrop = {
    param($s, $e)
    $files = $e.Data.GetData([Windows.Forms.DataFormats]::FileDrop)
    if ($files) { Add-Files $tabs.SelectedTab @($files) }
}
function Enable-Drop($ctl) { $ctl.AllowDrop = $true; $ctl.add_DragEnter($onDragEnter); $ctl.add_DragDrop($onDragDrop) }

# ---------------------------------------------------------------- Tarjetas (miniaturas)
$cardMenu = [Windows.Forms.ContextMenuStrip]::new()
$script:MenuPath = $null
function Get-Card($ctl) { if ($ctl.Tag -is [hashtable]) { $ctl } else { $ctl.Parent } }
$cardMenu.add_Opening({ $script:MenuPath = (Get-Card $cardMenu.SourceControl).Tag.Path })
$cardMenu.Items.Add('Ver en grande').add_Click({ Show-Viewer $tabs.SelectedTab $script:MenuPath })
$cardMenu.Items.Add('Abrir con el visor de Windows').add_Click({ Start-Process -FilePath $script:MenuPath })
$cardMenu.Items.Add('Copiar imagen').add_Click({
    $b = Load-Bitmap $script:MenuPath; [Windows.Forms.Clipboard]::SetImage($b); $b.Dispose()
})
$cardMenu.Items.Add('Mostrar en la carpeta').add_Click({ Start-Process explorer.exe "/select,`"$script:MenuPath`"" })
[void]$cardMenu.Items.Add([Windows.Forms.ToolStripSeparator]::new())
$cardMenu.Items.Add('Borrar foto').add_Click({
    $p = $tabs.SelectedTab
    if (Remove-Photos @($script:MenuPath)) { Fill-Tab $p }
})

function Set-CardSize($card) {
    $sz = Px $Config.tamano
    $card.Size = [Drawing.Size]::new($sz, $sz + (Px 30))
}

function New-Card([IO.FileInfo]$File) {
    $card = [Windows.Forms.Panel]::new()
    Set-CardSize $card
    $card.Margin = [Windows.Forms.Padding]::new((Px 6))
    $card.Padding = [Windows.Forms.Padding]::new((Px 5))
    $card.BackColor = $ColCard
    $card.ContextMenuStrip = $cardMenu

    $pb = [Windows.Forms.PictureBox]::new()
    $pb.Dock = 'Fill'; $pb.SizeMode = 'Zoom'; $pb.Cursor = 'Hand'
    $pb.ContextMenuStrip = $cardMenu
    try { $pb.Image = Get-Thumb $File } catch { $pb.BackColor = [Drawing.Color]::Gainsboro }
    $pb.add_Click({ Show-Viewer $tabs.SelectedTab $this.Parent.Tag.Path })
    $tip.SetToolTip($pb, $File.Name)

    $chk = [Windows.Forms.CheckBox]::new()
    $chk.Dock = 'Bottom'; $chk.Height = Px 26
    $chk.Text = $File.Name; $chk.AutoEllipsis = $true
    $chk.Font = [Drawing.Font]::new('Segoe UI', 9)
    $chk.ContextMenuStrip = $cardMenu
    $chk.add_CheckedChanged({
        $c = $this.Parent
        $c.BackColor = if ($this.Checked) { $ColSel } else { $ColCard }
        Update-Status
    })

    $card.Controls.Add($chk)
    $card.Controls.Add($pb)
    $pb.BringToFront()
    $card.Tag = @{ Path = $File.FullName; Check = $chk; Pic = $pb }
    foreach ($c in $card, $pb, $chk) { Enable-Drop $c }
    $card
}

function Get-Cards($page) { if ($page) { @($page.Tag.Flow.Controls | Where-Object { $_.Tag -is [hashtable] }) } }
function Get-SelectedPaths($page) { Get-Cards $page | Where-Object { $_.Tag.Check.Checked } | ForEach-Object { $_.Tag.Path } }

function Clear-Flow($flow) {
    $flow.SuspendLayout()
    foreach ($c in @($flow.Controls)) {
        if ($c.Tag -is [hashtable] -and $c.Tag.Pic.Image) { $c.Tag.Pic.Image.Dispose() }
        $c.Dispose()
    }
    $flow.Controls.Clear()
    $flow.ResumeLayout()
}

function Fill-Tab($page) {
    if (-not $page -or $script:Closing) { return }
    $t = $page.Tag
    $script:LoadToken++; $my = $script:LoadToken
    Clear-Flow $t.Flow
    $files = Get-ImageFiles $t.Dir
    $t.Count = $files.Count
    $t.Loaded = $true
    $t.Empty.Visible = ($files.Count -eq 0)
    if ($t.Empty.Visible) { $t.Empty.BringToFront() }
    Update-Status
    $i = 0
    foreach ($f in $files) {
        if ($script:Closing) { return }
        if ($my -ne $script:LoadToken) { $t.Loaded = $false; return }
        $t.Flow.Controls.Add((New-Card $f))
        $i++
        if ($i % 3 -eq 0) { [Windows.Forms.Application]::DoEvents() }
    }
}

function Resize-Cards {
    foreach ($p in $tabs.TabPages) {
        $f = $p.Tag.Flow; $f.SuspendLayout()
        foreach ($c in (Get-Cards $p)) { Set-CardSize $c }
        $f.ResumeLayout()
    }
}

# ---------------------------------------------------------------- Pestañas
function New-TabPageFor([string]$Dir) {
    $page = [Windows.Forms.TabPage]::new([IO.Path]::GetFileName($Dir))
    $page.UseVisualStyleBackColor = $false
    $page.BackColor = $ColBack

    $flow = [Windows.Forms.FlowLayoutPanel]::new()
    $flow.Dock = 'Fill'; $flow.AutoScroll = $true; $flow.BackColor = $ColBack
    $flow.Padding = [Windows.Forms.Padding]::new((Px 8))
    Enable-Drop $flow

    $empty = [Windows.Forms.Label]::new()
    $empty.Dock = 'Fill'; $empty.TextAlign = 'MiddleCenter'; $empty.Visible = $false
    $empty.ForeColor = [Drawing.Color]::Gray
    $empty.Font = [Drawing.Font]::new('Segoe UI', 12)
    $empty.Text = "Esta pestaña todavía no tiene fotos.`n`nArrastra imágenes aquí, usa ""Agregar fotos""`no pega una imagen copiada con Ctrl+V."
    Enable-Drop $empty

    $page.Controls.Add($flow)
    $page.Controls.Add($empty)
    $page.Tag = @{ Dir = $Dir; Flow = $flow; Empty = $empty; Loaded = $false; Count = 0 }
    $page
}

function Test-TabName([string]$Name, $Except) {
    if ([string]::IsNullOrWhiteSpace($Name)) { Show-Msg 'El nombre no puede estar vacío.' 'Warning'; return $false }
    if ($Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $Name.EndsWith('.')) {
        Show-Msg 'El nombre no puede contener estos caracteres:  \ / : * ? " < > |' 'Warning'; return $false
    }
    foreach ($p in $tabs.TabPages) {
        if ($p -ne $Except -and $p.Text -eq $Name) { Show-Msg "Ya existe una pestaña llamada ""$Name""." 'Warning'; return $false }
    }
    $true
}

function New-Tab {
    $name = Ask-Text 'Nueva pestaña' 'Nombre de la nueva pestaña:'
    if ($null -eq $name -or -not (Test-TabName $name $null)) { return }
    try {
        $dir = Join-Path $Root $name
        if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
        $page = New-TabPageFor $dir
        $tabs.TabPages.Add($page)
        $tabs.SelectedTab = $page
        Fill-Tab $page
        Save-Config
    } catch { Show-Msg "No se pudo crear la pestaña:`n$($_.Exception.Message)" 'Error' }
}

function Rename-Tab {
    $page = $tabs.SelectedTab; if (-not $page) { return }
    $name = Ask-Text 'Renombrar pestaña' 'Nuevo nombre:' $page.Text
    if ($null -eq $name -or $name -ceq $page.Text -or -not (Test-TabName $name $page)) { return }
    try {
        $old = $page.Tag.Dir; $new = Join-Path $Root $name
        if ($name -eq $page.Text) {
            # Solo cambian mayúsculas/minúsculas: Windows necesita un paso intermedio
            $tmp = Join-Path $Root ([guid]::NewGuid().ToString())
            [IO.Directory]::Move($old, $tmp); [IO.Directory]::Move($tmp, $new)
        } else {
            [IO.Directory]::Move($old, $new)
        }
        $page.Text = $name; $page.Tag.Dir = $new
        Fill-Tab $page
        Save-Config
    } catch { Show-Msg "No se pudo renombrar la pestaña:`n$($_.Exception.Message)" 'Error' }
}

function Remove-Tab {
    $page = $tabs.SelectedTab; if (-not $page) { return }
    $n = (Get-ImageFiles $page.Tag.Dir).Count
    $txt = "¿Borrar la pestaña ""$($page.Text)""" + $(if ($n -gt 0) { " y sus $n foto(s)" } else { '' }) +
           "?`n`nSe enviará a la Papelera de reciclaje (puedes recuperarla desde ahí)."
    if (-not (Ask-YesNo $txt)) { return }
    try {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($page.Tag.Dir,
            [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
            [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
        Clear-Flow $page.Tag.Flow
        $tabs.TabPages.Remove($page); $page.Dispose()
        Save-Config
        Update-Status
    } catch { Show-Msg "No se pudo borrar la pestaña:`n$($_.Exception.Message)" 'Error' }
}

function Move-Tab([int]$Delta) {
    $page = $tabs.SelectedTab; if (-not $page) { return }
    $i = $tabs.TabPages.IndexOf($page); $j = $i + $Delta
    if ($j -lt 0 -or $j -ge $tabs.TabPages.Count) { return }
    $script:Busy = $true
    try {
        $tabs.TabPages.Remove($page)
        $tabs.TabPages.Insert($j, $page)
        $tabs.SelectedTab = $page
    } finally { $script:Busy = $false }
    Update-Status
    Save-Config
}

# ---------------------------------------------------------------- Fotos
function Add-Files($page, [string[]]$Paths) {
    if (-not $page) { Show-Msg 'Primero crea una pestaña.'; return }
    $dir = $page.Tag.Dir; $n = 0; $errors = @()
    $all = foreach ($p in $Paths) {
        if (Test-Path -LiteralPath $p -PathType Container) {
            Get-ChildItem -LiteralPath $p -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
        } else { $p }
    }
    foreach ($p in $all) {
        if ($Exts -notcontains [IO.Path]::GetExtension($p).ToLowerInvariant()) { continue }
        if ([IO.Path]::GetDirectoryName($p) -eq $dir) { continue }   # ya está en esta pestaña
        try {
            $dest = Get-UniquePath $dir ([IO.Path]::GetFileName($p))
            [IO.File]::Copy($p, $dest)
            [IO.File]::SetCreationTime($dest, [DateTime]::Now)
            $n++
        } catch { $errors += [IO.Path]::GetFileName($p) }
    }
    if ($n -eq 0 -and $errors.Count -eq 0) {
        Show-Msg 'No se encontraron imágenes compatibles (JPG, PNG, BMP, GIF, TIFF).' 'Warning'
    }
    if ($errors.Count) { Show-Msg ("No se pudieron copiar:`n" + ($errors -join "`n")) 'Warning' }
    if ($n -gt 0) { Fill-Tab $page }
}

function Pick-Files {
    $page = $tabs.SelectedTab
    if (-not $page) { Show-Msg 'Primero crea una pestaña.'; return }
    $dlg = [Windows.Forms.OpenFileDialog]::new()
    $dlg.Title = "Agregar fotos a ""$($page.Text)"""
    $dlg.Multiselect = $true
    $dlg.Filter = 'Imágenes|*.jpg;*.jpeg;*.jfif;*.png;*.bmp;*.gif;*.tif;*.tiff|Todos los archivos|*.*'
    if ($dlg.ShowDialog($form) -eq 'OK') { Add-Files $page $dlg.FileNames }
    $dlg.Dispose()
}

function Paste-Clipboard {
    $page = $tabs.SelectedTab
    if (-not $page) { Show-Msg 'Primero crea una pestaña.'; return }
    if ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
        Add-Files $page @([Windows.Forms.Clipboard]::GetFileDropList())
    } elseif ([Windows.Forms.Clipboard]::ContainsImage()) {
        $img = [Windows.Forms.Clipboard]::GetImage()
        $dest = Get-UniquePath $page.Tag.Dir ('Pegada {0:yyyy-MM-dd HH.mm.ss}.png' -f (Get-Date))
        $img.Save($dest, [Drawing.Imaging.ImageFormat]::Png); $img.Dispose()
        Fill-Tab $page
    }
}

function Remove-Photos([string[]]$Paths) {
    if (-not $Paths -or $Paths.Count -eq 0) { return $false }
    $txt = if ($Paths.Count -eq 1) { "¿Borrar la foto ""$([IO.Path]::GetFileName($Paths[0]))""?" }
           else { "¿Borrar las $($Paths.Count) fotos seleccionadas?" }
    if (-not (Ask-YesNo "$txt`n`nSe enviarán a la Papelera de reciclaje.")) { return $false }
    foreach ($p in $Paths) {
        try {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,
                [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
        } catch {}
    }
    $true
}

function Remove-Selected {
    $page = $tabs.SelectedTab; if (-not $page) { return }
    $sel = @(Get-SelectedPaths $page)
    if ($sel.Count -eq 0) { Show-Msg 'Marca primero las fotos que quieres borrar (casilla debajo de cada foto).'; return }
    if (Remove-Photos $sel) { Fill-Tab $page }
}

function Select-All {
    $cards = Get-Cards $tabs.SelectedTab; if (-not $cards) { return }
    $allOn = -not ($cards | Where-Object { -not $_.Tag.Check.Checked })
    foreach ($c in $cards) { $c.Tag.Check.Checked = -not $allOn }
}

# ---------------------------------------------------------------- Visor en grande
function Show-Viewer($page, [string]$StartPath) {
    if (-not $page) { return }
    $st = @{
        files   = [Collections.ArrayList]@(Get-ImageFiles $page.Tag.Dir | ForEach-Object { $_.FullName })
        i       = 0
        changed = $false
    }
    $st.i = [Math]::Max(0, $st.files.IndexOf($StartPath))
    if ($st.files.Count -eq 0) { return }

    $v = [Windows.Forms.Form]::new()
    $v.Icon = $AppIcon; $v.Font = $form.Font; $v.KeyPreview = $true
    $v.BackColor = [Drawing.Color]::FromArgb(28, 28, 28)
    $v.Size = [Drawing.Size]::new((Px 1100), (Px 750)); $v.StartPosition = 'CenterParent'
    $v.WindowState = 'Maximized'; $v.ShowInTaskbar = $false

    $pb = [Windows.Forms.PictureBox]::new()
    $pb.Dock = 'Fill'; $pb.SizeMode = 'Zoom'; $pb.BackColor = $v.BackColor

    $bar = [Windows.Forms.Panel]::new()
    $bar.Dock = 'Bottom'; $bar.Height = Px 56; $bar.Width = Px 1100
    $bar.BackColor = [Drawing.Color]::FromArgb(45, 45, 45)

    function New-VButton([string]$Text, [int]$X, [string]$Anchor) {
        $b = [Windows.Forms.Button]::new()
        $b.Text = $Text; $b.FlatStyle = 'Flat'; $b.FlatAppearance.BorderSize = 0
        $b.ForeColor = [Drawing.Color]::White; $b.BackColor = [Drawing.Color]::FromArgb(70, 70, 70)
        $b.Bounds = [Drawing.Rectangle]::new($X, (Px 10), (Px 130), (Px 36))
        $b.Anchor = $Anchor; $b.TabStop = $false; $b.Cursor = 'Hand'
        $b.add_PreviewKeyDown({ param($s, $e) if ("$($e.KeyCode)" -in 'Left', 'Right') { $e.IsInputKey = $true } })
        $bar.Controls.Add($b); $b
    }
    $bPrev  = New-VButton ([string][char]0x25C0 + '  Anterior') (Px 12) 'Top, Left'
    $bNext  = New-VButton ('Siguiente  ' + [char]0x25B6) (Px 150) 'Top, Left'
    $bClose = New-VButton 'Cerrar (Esc)' ($bar.Width - (Px 142)) 'Top, Right'
    $bDel   = New-VButton 'Borrar foto' ($bar.Width - (Px 280)) 'Top, Right'
    $bDel.BackColor = [Drawing.Color]::FromArgb(150, 45, 45)

    $lbl = [Windows.Forms.Label]::new()
    $lbl.ForeColor = [Drawing.Color]::White; $lbl.TextAlign = 'MiddleCenter'; $lbl.AutoEllipsis = $true
    $lbl.Bounds = [Drawing.Rectangle]::new((Px 290), (Px 10), ($bar.Width - (Px 580)), (Px 36))
    $lbl.Anchor = 'Top, Left, Right'
    $bar.Controls.Add($lbl)

    $v.Controls.Add($pb); $v.Controls.Add($bar); $pb.BringToFront()

    $show = {
        if ($st.files.Count -eq 0) { $v.Close(); return }
        if ($st.i -ge $st.files.Count) { $st.i = 0 }
        if ($st.i -lt 0) { $st.i = $st.files.Count - 1 }
        $path = $st.files[$st.i]; $name = [IO.Path]::GetFileName($path)
        $old = $pb.Image
        try { $pb.Image = Load-Bitmap $path } catch { $pb.Image = $null; $name += '  (no se pudo abrir)' }
        if ($old) { $old.Dispose() }
        $lbl.Text = '{0}      {1} de {2}' -f $name, ($st.i + 1), $st.files.Count
        $v.Text = "$($page.Text)  -  $name"
    }
    $prev = { $st.i--; & $show }
    $next = { $st.i++; & $show }
    $del = {
        if (Remove-Photos @($st.files[$st.i])) {
            $st.files.RemoveAt($st.i); $st.changed = $true; & $show
        }
    }
    $bPrev.add_Click($prev); $bNext.add_Click($next); $bDel.add_Click($del)
    $bClose.add_Click({ $v.Close() })
    $pb.add_DoubleClick({ $v.Close() })
    $v.add_MouseWheel({ param($s, $e) if ($e.Delta -gt 0) { & $prev } else { & $next } })
    $v.add_KeyDown({
        param($s, $e)
        switch ($e.KeyCode) {
            'Left'   { & $prev; $e.Handled = $true }
            'Right'  { & $next; $e.Handled = $true }
            'Escape' { $v.Close() }
            'Delete' { & $del }
            'Home'   { $st.i = 0; & $show }
            'End'    { $st.i = $st.files.Count - 1; & $show }
        }
    })
    $v.add_Shown({ & $show; $v.Activate() })
    [void]$v.ShowDialog($form)
    if ($pb.Image) { $pb.Image.Dispose() }
    $v.Dispose()
    if ($st.changed) { Fill-Tab $page }
}

# ---------------------------------------------------------------- Barra de herramientas
[void](Add-ToolButton 'Nueva pestaña' 'Crear una pestaña nueva (Ctrl+T)' { New-Tab })
[void](Add-ToolButton 'Renombrar' 'Cambiar el nombre de la pestaña actual (F2)' { Rename-Tab })
[void](Add-ToolButton 'Borrar pestaña' 'Borrar la pestaña actual y sus fotos' { Remove-Tab })
[void](Add-ToolButton ([string][char]0x25C0) 'Mover la pestaña a la izquierda' { Move-Tab -1 })
[void](Add-ToolButton ([string][char]0x25B6) 'Mover la pestaña a la derecha' { Move-Tab 1 })
Add-ToolSep
[void](Add-ToolButton 'Agregar fotos' 'Agregar fotos a la pestaña actual (o arrástralas a la ventana)' { Pick-Files })
[void](Add-ToolButton 'Borrar seleccionadas' 'Borrar las fotos marcadas (Supr)' { Remove-Selected })
[void](Add-ToolButton 'Seleccionar todo' 'Marcar / desmarcar todas (Ctrl+A)' { Select-All })
Add-ToolSep
[void](Add-ToolButton 'Abrir carpeta' 'Abrir la carpeta de esta pestaña en el Explorador' {
    if ($tabs.SelectedTab) { Start-Process explorer.exe "`"$($tabs.SelectedTab.Tag.Dir)`"" }
})

$track = [Windows.Forms.TrackBar]::new()
$track.Minimum = 100; $track.Maximum = 320; $track.TickStyle = 'None'
$track.AutoSize = $false; $track.Width = Px 170; $track.Height = Px 28
$track.Value = $Config.tamano; $track.BackColor = [Drawing.Color]::White
$trackHost = [Windows.Forms.ToolStripControlHost]::new($track)
$trackHost.Alignment = 'Right'
[void]$tool.Items.Add($trackHost)
$sizeLbl = [Windows.Forms.ToolStripLabel]::new('Tamaño:')
$sizeLbl.Alignment = 'Right'
[void]$tool.Items.Add($sizeLbl)
$track.add_ValueChanged({ $Config.tamano = $track.Value; Resize-Cards })

# ---------------------------------------------------------------- Eventos
$tabs.add_SelectedIndexChanged({
    if ($script:Busy) { return }
    $p = $tabs.SelectedTab
    if ($p -and -not $p.Tag.Loaded) { Fill-Tab $p }
    Update-Status
})
$tabs.add_MouseDoubleClick({ Rename-Tab })

$form.add_KeyDown({
    param($s, $e)
    if ($e.Control -and $e.KeyCode -eq 'V') { Paste-Clipboard; $e.Handled = $true }
    elseif ($e.Control -and $e.KeyCode -eq 'T') { New-Tab; $e.Handled = $true }
    elseif ($e.Control -and $e.KeyCode -eq 'A') { Select-All; $e.Handled = $true }
    elseif ($e.KeyCode -eq 'F2') { Rename-Tab }
    elseif ($e.KeyCode -eq 'Delete') { Remove-Selected }
})

$form.add_Shown({
    # Al abrirse desde el acceso directo (PowerShell oculto) Windows puede dejar la ventana oculta/minimizada
    if ($Native) { [void]$Native::ShowWindow($form.Handle, 1) }
    $form.Activate()
    $script:Busy = $true
    $dirs = @(Get-ChildItem -LiteralPath $Root -Directory | Sort-Object CreationTime, Name)
    $order = @($Config.orden)
    $dirs = @($dirs | Sort-Object @{ Expression = { $k = [Array]::IndexOf($order, $_.Name); if ($k -lt 0) { 99999 } else { $k } } }, CreationTime, Name)
    foreach ($d in $dirs) { $tabs.TabPages.Add((New-TabPageFor $d.FullName)) }
    $target = $tabs.TabPages | Where-Object { $_.Text -eq $Config.ultimaPestana } | Select-Object -First 1
    if ($target) { $tabs.SelectedTab = $target }
    $script:Busy = $false
    Update-Status
    if ($tabs.SelectedTab) { Fill-Tab $tabs.SelectedTab }
})

$form.add_FormClosing({ $script:Closing = $true; Save-Config })

$form.Controls.Add($tabs)
$form.Controls.Add($tool)
$form.Controls.Add($status)
$tabs.BringToFront()

try {
    [void]$form.ShowDialog()
} catch {
    [void][Windows.Forms.MessageBox]::Show("Error inesperado:`n$($_.Exception.Message)", 'NezvImage', 'OK', 'Error')
}
