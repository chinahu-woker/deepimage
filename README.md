<p align="center">
  <img src="docs/poster/deepimage-banner-1280.png" alt="deepImage — 在对话里，说一句就出图" width="100%">
</p>

<h1 align="center">deepImage</h1>

<p align="center">
  为 DeepSeek Harness 接入图片与视频生成，让创意从一句话开始。
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能一览">功能一览</a> ·
  <a href="#配置与使用">配置与使用</a> ·
  <a href="README.zh.md">详细文档</a> ·
  <a href="LICENSE">MIT 许可证</a>
</p>

## 选择版本

当前页面介绍 **New API 公司版**：登录 AIKNA 后自动配置兼容模型。[开源版](https://github.com/chinahu-woker/deepimage/tree/main) 可手动配置图片和视频服务商，适合使用自己的 API 服务。

两个版本使用相同的插件标识，请根据需要选择其一安装。公司版的发布标签以 `newapi-v` 开头，开源版以 `v` 开头；下载 Release 时请留意安装包名称。

## 功能一览

- **对话生图**：选择默认绘图模型后，直接在对话中描述想要的画面。
- **视频生成**：提交异步视频任务，并查询任务状态和结果。
- **New API 连接**：登录 [AIKNA New API](https://token.aikna.cn/)，自动配置账号可用的兼容对话、图片和视频模型。
- **灵活配置**：管理多个服务商，为每个 API 设置请求超时，并通过高级配置适配不同的请求与响应格式。

使用支持工具调用的对话模型，并在 deepImage 中配置默认图片服务商后，可以直接描述要生成的图片。明确要求 SVG、矢量图或用代码绘制时，仍按指定方式处理。
- **生成反馈**：图片生成期间显示加载动画和估算进度，方便了解等待状态。

## 桌面版安装器

安装器包含开源版和公司版，解压后双击打开并选择所需版本：

- [下载 macOS 安装器](https://github.com/chinahu-woker/deepimage/releases/download/newapi-v0.1.9/deepImage-installer-macOS.zip)
- [下载 Windows 安装器](https://github.com/chinahu-woker/deepimage/releases/download/newapi-v0.1.9/deepImage-installer-Windows.zip)

安装器每次运行都会联网下载所选版本的最新插件。安装前请先启动一次 DeepSeek Harness 桌面版，再完全退出。安装可能需要联网。macOS 安装器尚未经过 Apple 公证，Windows 安装器尚未签名，也尚未在 Windows 真机验证，系统可能阻止运行。使用步骤与构建要求见 [桌面安装器说明](installer/README.md)。

## 快速开始

需要安装 DeepSeek Harness、Node.js 和 pnpm。本分支已在 Harness `0.2.1-rc.5` 开发环境中验证；Harness 仍处于预览阶段，其他版本的插件 API 可能有所差异。

1. 克隆并安装当前分支：

   ```sh
   git clone --branch newapi-login https://github.com/chinahu-woker/deepimage.git
   cd deepimage
   dsh plugin --profile web add .
   dsh --profile web
   ```

   如果使用其他 profile，将 `web` 替换为实际名称。安装到正在运行的 profile 后，需要重启该 profile。

2. 打开 **设置 → deepImage**，使用 AIKNA New API 账号登录。插件会根据账户可用模型及其声明的接口类型，自动添加支持 OpenAI Chat Completions、Responses、Images 和 Video 的模型。对话模型可在 Harness 的模型选择器中选择；点击账号卡片上的刷新图标可重新同步。账号启用两步认证时，可以输入验证码或备用码。

3. 在“绘图”中选择默认模型，然后在对话里试试：

   > 画一张雨后霓虹街道的电影感插画。

模型会根据对话内容决定是否调用绘图工具。视频生成则通过创建任务和查询状态获取结果。

## 检查插件更新

安装包含更新功能的版本后，打开 **设置 → deepImage → 设置 → 插件更新**，点击“检查更新”；发现新版本时点击“更新到”即可安装。开源版和 New API 公司版分别检查各自的 Release，更新后按提示重启应用。

公开仓库的更新无需 GitHub Token。旧版本如无法直接更新，可先手动安装一次新版本；本地源码链接不会被自动覆盖。

## 配置与使用

### 账号与密钥

首次连接会在 New API 中创建名为 `deepImage` 的 API 密钥，后续连接会尝试复用。新密钥不设置独立额度或过期时间，调用使用账户额度，可在 New API 中管理。密钥保存在 Harness 凭据服务中，登录密码不会保存。

登录后，设置页显示账号、余额及更新时间。登录会话由 Harness 凭据服务保存，重启后会尝试自动恢复并刷新余额；会话被撤销或过期时需要重新登录。旧版本用户首次升级后需要重新登录一次以保存会话。站点未返回头像时，卡片使用账号名称首字作为头像。

### 服务商与超时

登录后可在“绘图”或“视频”选项卡中添加、编辑服务商。填写 API 地址、模型 ID 和凭据引用；API Key 可保存到 Harness 凭据服务，也可复用已有凭据引用。自动配置会保留已有服务商。

在服务商编辑页面可设置该 API 的请求超时，单位为秒。留空时沿用原有全局 `timeoutMs` 配置；全局未设置时默认为 300 秒（5 分钟）。图片生成请求超时不代表服务商已停止生成，请确认结果后再决定是否重试。视频是异步任务，单次查询超时也不代表任务失败，可使用原任务 ID 再次查询。

旧版本的全局默认值 60 秒会按 5 分钟处理；如需 60 秒，可在服务商编辑页面单独设置。

不同服务商的协议和模型参数可能不同，可在高级设置中调整请求体和响应字段路径；自动接入仅覆盖上述兼容接口。New API 视频任务完成后，插件会下载视频并作为附件返回，大小上限为 200 MB。

图片生成进度根据等待时间估算，最多显示 95%，并非服务商返回的实际进度；生成完成或失败以服务商的结果为准。

更多配置、开发与调试说明见 [详细文档](README.zh.md)。

## 打包与发布

```sh
mkdir -p dist
npm run pack:plugin
```

本地打包生成 `dsh-media-generation-<版本号>.tgz`，可通过 `dsh plugin --profile web add <安装包路径>` 安装。已有 Release 不一定包含本分支的最新功能，请以 Release 对应的版本为准。

公司版在 `newapi-login` 分支维护：更新 `package.json` 版本并提交后，推送对应标签（例如 `newapi-v0.1.0`）。GitHub Actions 会生成名为 `deepimage-newapi-<版本号>.tgz` 的 Release 安装包，并保留开源版的 Latest 标记。开源版的标签和发布步骤见 [开源版说明](https://github.com/chinahu-woker/deepimage/tree/main#打包与发布)。仓库和 Release 的可见性遵循 GitHub 仓库访问权限。

## 许可证

[MIT](LICENSE)
