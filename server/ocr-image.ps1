param(
  [Parameter(Mandatory=$true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.IsGenericMethodDefinition -and
    $_.GetParameters().Count -eq 1
  } |
  Select-Object -First 1)

function Wait-WinRtOperation($Operation, [Type]$ResultType) {
  $task = $script:asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

function New-OcrEngine {
  $available = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
  foreach ($languageTag in @('zh-Hans-CN', 'zh-CN', 'zh-Hans', 'en-US')) {
    foreach ($language in $available) {
      if ($language.LanguageTag -eq $languageTag) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        if ($engine) { return $engine }
      }
    }
  }
  $profileEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($profileEngine) { return $profileEngine }
  throw 'Windows OCR language pack is unavailable.'
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw 'Image file does not exist.'
}

$file = Wait-WinRtOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Path).Path)) ([Windows.Storage.StorageFile])
$stream = $null
try {
  $stream = Wait-WinRtOperation ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $decoder = Wait-WinRtOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Wait-WinRtOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = New-OcrEngine
  $result = Wait-WinRtOperation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $result.Lines) {
    if ($line.Text) { $lines += ($line.Text -replace "`0", '') }
  }
  Write-Output ($lines -join "`n")
} finally {
  if ($stream) { $stream.Dispose() }
}
