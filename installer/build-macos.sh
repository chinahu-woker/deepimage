#!/bin/sh
# Build installers that download the selected edition from GitHub at install time.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
out_dir=${DEEPIMAGE_OUTPUT_DIR:-"$root/dist"}
mac_zip="$out_dir/deepImage-installer-macOS.zip"
win_zip="$out_dir/deepImage-installer-Windows.zip"
if [ -e "$mac_zip" ] || [ -e "$win_zip" ]; then
  echo '目标安装器已存在，请先移动或删除旧文件。' >&2
  exit 1
fi
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/deepimage-installer.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
mkdir -p "$out_dir" "$build_dir/windows/deepImage Installer"
app="$build_dir/安装 deepImage.app"
/usr/bin/osacompile -o "$app" "$root/installer/macos/installer.applescript"
cp "$root/installer/macos/install.sh" "$app/Contents/Resources/install.sh"
cp "$root/installer/download-latest.cjs" "$app/Contents/Resources/"
/usr/bin/codesign --force --deep --sign - "$app" >/dev/null
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$mac_zip"
win_dir="$build_dir/windows/deepImage Installer"
cp "$root/installer/windows/install.cmd" "$win_dir/Install deepImage.cmd"
cp "$root/installer/windows/install.ps1" "$win_dir/install.ps1"
cp "$root/installer/download-latest.cjs" "$win_dir/"
(cd "$build_dir/windows" && COPYFILE_DISABLE=1 /usr/bin/zip -qr "$win_zip" "deepImage Installer")
printf '已生成：\n%s\n%s\n' "$mac_zip" "$win_zip"
