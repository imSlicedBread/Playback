param([string]$ObsPath = 'C:\Program Files\obs-studio')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
$deps = Join-Path $root '.deps'
New-Item -ItemType Directory -Force $deps | Out-Null
$sourceArchive = Join-Path $deps 'installer-source.zip'
Compress-Archive -LiteralPath "$root/src", "$root/vendor", "$root/CMakeLists.txt", "$root/build-windows.ps1", "$root/install-local.ps1", "$root/resources.qrc", "$root/watch-controller.js", "$root/README.md", "$root/LICENSE" -DestinationPath $sourceArchive -Force
function Fetch-Verified($Url, $Name, $Hash) {
  $file = Join-Path $deps $Name
  if (!(Test-Path -LiteralPath $file)) { Invoke-WebRequest $Url -OutFile $file }
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $Hash) { throw "Checksum mismatch: $Name" }
  return $file
}
$qt = Fetch-Verified 'https://github.com/obsproject/obs-deps/releases/download/2026-08-26/windows-deps-qt6-2026-08-26-x64-RelWithDebInfo.zip' 'qt.zip' '590B8122154E5FDA214A4B7EFD0EA50C69036DDCF6511F0A4AC11AE851DE1A23'
$obs = Fetch-Verified 'https://github.com/obsproject/obs-studio/archive/refs/tags/32.2.2.zip' 'obs.zip' 'F15F001F1FA526405318835F44F9910046502F496EBC3A30D5296A5018B831AA'
if ((Get-FileHash -LiteralPath "$root/vendor/browser-panel.hpp" -Algorithm SHA256).Hash -ne '519895569D7567B8677804F4031D96FF99FEE5D1164600C48DABE15F13C4A253') { throw 'Browser panel header checksum mismatch' }
if (!(Test-Path "$deps/qt/lib/Qt6Core.lib")) { Expand-Archive -LiteralPath $qt -DestinationPath "$deps/qt" -Force }
if (!(Test-Path "$deps/obs/obs-studio-32.2.2/libobs/obs.h")) { Expand-Archive -LiteralPath $obs -DestinationPath "$deps/obs" -Force }
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Install Visual Studio with the Desktop development with C++ workload.' }
$toolset = Get-ChildItem -LiteralPath "$vs/VC/Tools/MSVC" -Directory | Sort-Object Name -Descending | Select-Object -First 1
$tools = Join-Path $toolset.FullName 'bin/Hostx64/x64'
$imports = Join-Path $deps 'imports'
New-Item -ItemType Directory -Force $imports | Out-Null
foreach ($name in @('obs', 'obs-frontend-api', 'libobs-winrt')) {
  $dll = Join-Path $ObsPath "bin/64bit/$name.dll"
  if (!(Test-Path -LiteralPath $dll)) { throw "Missing OBS runtime: $dll" }
  $exports = & "$tools/dumpbin.exe" /nologo /exports $dll
  if ($LASTEXITCODE) { throw 'dumpbin failed' }
  $symbols = @($exports | ForEach-Object { if ($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)') { $Matches[1] } })
  if ($symbols.Count -lt 10) { throw "Missing exports in $name" }
  @("LIBRARY $name.dll", 'EXPORTS') + $symbols | Set-Content -LiteralPath "$imports/$name.def" -Encoding ascii
  & "$tools/lib.exe" /nologo /machine:x64 "/def:$imports/$name.def" "/out:$imports/$name.lib"
  if ($LASTEXITCODE) { throw 'Import library generation failed' }
}
@('#pragma once', '#define OBS_RELEASE_CANDIDATE 0', '#define OBS_BETA 0') | Set-Content -LiteralPath "$imports/obsconfig.h" -Encoding ascii
& cmake -S $root -B "$root/build" -G 'Visual Studio 18 2026' -A x64 "-DCMAKE_PREFIX_PATH=$deps/qt" "-DOBS_HEADERS=$deps/obs/obs-studio-32.2.2" "-DOBS_BROWSER_HEADERS=$root/vendor" "-DOBS_IMPORT_LIBS=$imports" "-DOBS_RUNTIME_PATH=$ObsPath/bin/64bit" "-DINSTALLER_SOURCE_ZIP=$sourceArchive"
if ($LASTEXITCODE) { throw 'CMake configuration failed' }
& cmake --build "$root/build" --config RelWithDebInfo --parallel
if ($LASTEXITCODE) { throw 'Plugin compilation failed' }
& ctest --test-dir "$root/build" -C RelWithDebInfo --output-on-failure
if ($LASTEXITCODE) { throw 'Native plugin tests failed' }
& cmake --install "$root/build" --config RelWithDebInfo --prefix "$root/package"
if ($LASTEXITCODE) { throw 'Plugin packaging failed' }
Copy-Item -LiteralPath "$root/README.md", "$root/LICENSE" -Destination "$root/package"
$sourcePath = Join-Path $root 'package/source'
New-Item -ItemType Directory -Force $sourcePath | Out-Null
foreach ($name in @('src', 'vendor', 'CMakeLists.txt', 'build-windows.ps1', 'install-local.ps1', 'resources.qrc', 'watch-controller.js', 'README.md', 'LICENSE')) {
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination $sourcePath -Recurse -Force
}
$installer = Join-Path $root 'fKey-Playback-OBS-Plugin-Setup-0.1.2.exe'
Copy-Item -LiteralPath "$root/package/fKey-Playback-OBS-Plugin-Setup-0.1.2.exe" -Destination $installer -Force
((Get-FileHash -LiteralPath $installer).Hash.ToLowerInvariant()+'  '+(Split-Path -Leaf $installer)) | Set-Content -LiteralPath ($installer+'.sha256') -Encoding ascii
Compress-Archive -LiteralPath "$root/package/obs-plugins", "$root/package/source", "$root/package/README.md", "$root/package/LICENSE", $installer -DestinationPath "$root/fplayback-youtube-0.1.2-windows-x64.zip" -Force
((Get-FileHash -LiteralPath "$root/fplayback-youtube-0.1.2-windows-x64.zip").Hash.ToLowerInvariant()+'  fplayback-youtube-0.1.2-windows-x64.zip') | Set-Content -LiteralPath "$root/fplayback-youtube-0.1.2-windows-x64.zip.sha256" -Encoding ascii
Get-FileHash -LiteralPath "$root/fplayback-youtube-0.1.2-windows-x64.zip" -Algorithm SHA256 | Format-List
Write-Output "Built plugin: $root/package/obs-plugins/64bit/fplayback-youtube.dll"
