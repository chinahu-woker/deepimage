#!/bin/sh
set -eu

# Keep local package dependencies available to pnpm after the installer is removed.
app=$1
edition=$2
cli="$app/Contents/Resources/runtime/cli/bin/dsh"
[ -x "$cli" ] || { echo '无法找到桌面应用内置的 dsh 命令。请检查所选应用是否为官方 DeepSeek Harness 桌面版。' >&2; exit 1; }
node="$app/Contents/MacOS/DeepSeek Harness"
[ -x "$node" ] || { echo '无法找到桌面应用运行环境。' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
package=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/deepimage-download.XXXXXX")
trap 'rm -f "$package"' EXIT HUP INT TERM
ELECTRON_RUN_AS_NODE=1 "$node" "$script_dir/download-latest.cjs" "$edition" "$package"
hash=$(/usr/bin/shasum -a 256 "$package" | /usr/bin/awk '{print $1}')
store="${HOME}/Library/Application Support/deepImage/installer-packages"
mkdir -p "$store"
permanent="$store/$hash.tgz"
if [ ! -f "$permanent" ]; then
  tmp="$permanent.tmp.$$"
  trap 'rm -f "$tmp" "$package"' EXIT HUP INT TERM
  cp "$package" "$tmp"
  mv "$tmp" "$permanent"
  trap 'rm -f "$package"' EXIT HUP INT TERM
else
  cmp -s "$package" "$permanent" || { echo "已保存的插件包校验失败，请联系维护人员。" >&2; exit 1; }
fi
"$cli" plugin --profile desktop add "$permanent"
