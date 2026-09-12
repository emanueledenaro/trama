#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
configuration="${1:-release}"
swift build -c "$configuration"
bin_dir="$(swift build -c "$configuration" --show-bin-path)"
app_dir="$PWD/build/Trama.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$bin_dir/Trama" "$app_dir/Contents/MacOS/Trama"
cp "$bin_dir/TramaMonitor" "$app_dir/Contents/MacOS/TramaMonitor"
mkdir -p "$app_dir/Contents/Library/LaunchAgents"
cp scripts/dev.trama.monitor.plist "$app_dir/Contents/Library/LaunchAgents/"
for bundle in "$bin_dir"/*.bundle; do
  if [ -d "$bundle" ]; then cp -R "$bundle" "$app_dir/Contents/Resources/"; fi
done
cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Trama</string>
<key>CFBundleIdentifier</key><string>dev.trama.mac</string>
<key>CFBundleName</key><string>Trama</string>
<key>CFBundleDisplayName</key><string>Trama</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>Copyright © 2026 Emanuele Denaro. MIT.</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$app_dir"
echo "$app_dir"
