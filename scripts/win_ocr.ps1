Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStreamReference, Windows.Storage.Streams, ContentType=WindowsRuntime]

function Await($t) {
  $m = ([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetType('System.WindowsRuntimeSystemExtensions') }).GetType('System.WindowsRuntimeSystemExtensions')
  $g = $m.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $g = $g.MakeGenericMethod($t.GetType().GenericTypeArguments[0])
  $task = $g.Invoke($null, @($t))
  $task.Wait()
  return $task.Result
}

function Ocr-File($path) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path))
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync())
  $result = Await ($engine.RecognizeAsync($bitmap))
  return ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
}

$base = 'C:\Users\enock\.cursor\projects\c-Users-enock-OneDrive-Documents-GitHub-Metrorail-Next-Train-Source-Code\assets\northern_crops'
foreach ($f in @('RIGHT_full.png','R_bell_cape.png','R_strand_bell.png','LEFT_full.png')) {
  Write-Output "===== $f ====="
  try { Ocr-File (Join-Path $base $f) } catch { Write-Output $_.Exception.Message }
  Write-Output ''
}
