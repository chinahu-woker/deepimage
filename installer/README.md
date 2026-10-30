# deepImage 桌面安装器

安装器包含开源版和 New API 公司版。两个版本使用相同插件标识，安装时选择其中一个；公司版连接 AIKNA 站点。

## 使用

1. 先安装 DeepSeek Harness 桌面应用，打开一次，然后完全退出（macOS 按 ⌘Q；Windows 从托盘退出）。
2. macOS：解压 `deepImage-installer-macOS.zip`，双击「安装 deepImage.app」。Windows：解压 `deepImage-installer-Windows.zip`，双击文件夹中的 `Install deepImage.cmd`。
3. 在安装器中选择版本并按提示安装，完成后重新打开 DeepSeek Harness，在「设置 → deepImage」中配置。

安装过程可能需要联网下载依赖。插件包会复制到用户目录的 `deepImage/installer-packages` 中，供桌面应用后续管理使用。安装器不自动关闭桌面应用，也不修改已有的账号或服务商配置。

macOS 安装器目前使用临时签名，未经过 Apple 公证；从网络下载后，Gatekeeper 可能阻止直接打开。Windows 安装器也未签名，系统或企业安全策略可能提示或阻止运行。面向用户分发前，需要使用开发者证书完成签名；macOS 还需进行公证。Windows 安装器尚需在 Windows 真机上完成安装验证。

## 构建

在 macOS 的 New API 分支中，确保本地 `main` 是要打包的开源版代码，安装 Git、Node.js 和 npm，然后运行：

```sh
installer/build-macos.sh
```

生成的两个 ZIP 位于 `dist/`，各自包含从 `main` 和当前工作目录构建的插件包。脚本不会覆盖同名 ZIP。脚本运行时需要访问 macOS 自带的 `osacompile`、`codesign` 和 `ditto`。打包不等于发布；如需面向用户分发，还需处理签名、公证和发布。
