本版改进了图片生成体验和 New API 账户管理：

- 图片请求优先引导对话模型调用生图工具，保留明确要求 SVG 或代码绘制的场景。
- 图片生成完成后只在正文显示一次预览，生成进度与失败详情仍可查看。
- 图片、视频及自动同步的对话模型默认请求超时为 5 分钟，改进超时、取消和视频任务状态判断。
- New API 账号失效时自动清除本地登录状态并返回登录页面，保留可恢复的持久会话。

本 Release 提供公司版插件 `deepimage-newapi-0.1.9.tgz` 和 macOS、Windows 安装器。安装器支持选择开源版或公司版，每次安装时下载并校验所选版本的最新插件。

先安装并打开一次 DeepSeek Harness，然后完全退出。下载对应系统的 ZIP 并解压：macOS 双击「安装 deepImage.app」，Windows 双击 `Install deepImage.cmd`。完成安装后重新打开 Harness，在「设置 → deepImage」中登录。已安装用户也可通过插件设置检查更新。

macOS 安装器尚未经过 Apple 公证，Windows 安装器尚未签名，也尚未在 Windows 真机验证；系统可能提示或阻止运行。
