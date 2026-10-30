包含 macOS 和 Windows 安装器，可在安装时选择开源版或 New API 公司版。两个版本新增插件更新入口，可分别检查并安装对应版本的后续更新；旧版本需要先手动安装本版。仓库为私有时，需要为每个用户配置有仓库 Contents 只读权限的 GitHub Token。公司版支持保存登录会话并在重启后尝试恢复；从旧版升级的用户需重新登录一次。

1. 先打开一次 DeepSeek Harness 桌面应用，再完全退出。
2. 下载对应系统的 ZIP 并解压；macOS 打开「安装 deepImage.app」，Windows 打开 `Install deepImage.cmd`。
3. 选择版本，完成安装后重新打开 DeepSeek Harness，在「设置 → deepImage」中配置。

macOS 安装器使用临时签名，尚未经过 Apple 公证；Windows 安装器尚未签名，也尚未在 Windows 真机验证。系统可能阻止运行，安装过程可能需要联网。

`deepimage-newapi-<版本号>.tgz` 是公司版插件包，适用于需要手动安装的用户。
