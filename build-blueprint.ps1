# Repackages the extension into pteromonaco.blueprint (a plain zip archive).
# Entry names use forward slashes, which is what unzip/PHP ZipArchive expect.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$out = Join-Path $root 'pteromonaco.blueprint'

$files = @(
    'components/Components.yml',
    'components/Editor.tsx',
    'components/tsconfig.json',
    'conf.yml',
    'icon.png',
    'style.css',
    'view.blade.php'
)

foreach ($f in $files) {
    $p = Join-Path $root $f
    if (-not (Test-Path -LiteralPath $p)) { throw "Missing source file: $f" }
}

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($f in $files) {
        $p = Join-Path $root $f
        $entry = $zip.CreateEntry($f, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($p)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Dispose()
        }
    }
} finally {
    $zip.Dispose()
}

Write-Output "built: $out ($((Get-Item -LiteralPath $out).Length) bytes)"
