#!/bin/sh
# Build both desktop installers on macOS from this New API checkout and local main.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
git_bin=${GIT_BIN:-git}
out_dir=${DEEPIMAGE_OUTPUT_DIR:-"$root/dist"}
mac_zip="$out_dir/deepImage-installer-macOS.zip"
win_zip="$out_dir/deepImage-installer-Windows.zip"
if [ -e "$mac_zip" ] || [ -e "$win_zip" ]; then
  echo '目标安装器已存在，请先移动或删除旧文件。' >&2
  exit 1
fi
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/deepimage-installer.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
mkdir -p "$out_dir" "$build_dir/open" "$build_dir/packages" "$build_dir/windows/deepImage Installer"
"$git_bin" -C "$root" archive main | tar -x -C "$build_dir/open"
npm pack "$build_dir/open" --pack-destination "$build_dir/packages" --silent >/dev/null
open_version=$(node -p 'require(process.argv[1]).version' "$build_dir/open/package.json")
mv "$build_dir/packages/dsh-media-generation-$open_version.tgz" "$build_dir/packages/deepimage-open-source.tgz"
npm pack "$root" --pack-destination "$build_dir/packages" --silent >/dev/null
company_version=$(node -p 'require(process.argv[1]).version' "$root/package.json")
mv "$build_dir/packages/dsh-media-generation-$company_version.tgz" "$build_dir/packages/deepimage-newapi.tgz"
app="$build_dir/安装 deepImage.app"
/usr/bin/osacompile -o "$app" "$root/installer/macos/installer.applescript"
cp "$root/installer/macos/install.sh" "$app/Contents/Resources/install.sh"
cp "$build_dir/packages/"*.tgz "$app/Contents/Resources/"
/usr/bin/codesign --force --deep --sign - "$app" >/dev/null
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$mac_zip"
win_dir="$build_dir/windows/deepImage Installer"
cp "$root/installer/windows/install.cmd" "$win_dir/Install deepImage.cmd"
cp "$root/installer/windows/install.ps1" "$win_dir/install.ps1"
cp "$build_dir/packages/"*.tgz "$win_dir/"
(cd "$build_dir/windows" && COPYFILE_DISABLE=1 /usr/bin/zip -qr "$win_zip" "deepImage Installer")
printf '已生成：\n%s\n%s\n' "$mac_zip" "$win_zip"
