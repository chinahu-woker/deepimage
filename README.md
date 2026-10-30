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

## 功能一览

- **对话生图**：选择默认绘图模型后，直接在对话中描述想要的画面。
- **视频生成**：提交异步视频任务，并查询任务状态和结果。
- **New API 连接**：登录 [AIKNA New API](https://token.aikna.cn/)，自动配置账号可用的兼容图片和视频模型。
- **灵活配置**：管理多个服务商，为每个 API 设置请求超时，并通过高级配置适配不同的请求与响应格式。
- **生成反馈**：图片生成期间显示加载动画和估算进度，方便了解等待状态。

## 快速开始

需要安装 DeepSeek Harness、Node.js 和 pnpm。本分支已在 Harness `0.2.1-rc.2` 开发环境中验证；Harness 仍处于预览阶段，其他版本的插件 API 可能有所差异。

1. 克隆并安装当前分支：

   ```sh
   git clone --branch newapi-login https://github.com/chinahu-woker/deepimage.git
   cd deepimage
   dsh plugin --profile web add .
   dsh --profile web
   ```

   如果使用其他 profile，将 `web` 替换为实际名称。安装到正在运行的 profile 后，需要重启该 profile。

2. 打开 **设置 → deepImage**，使用 AIKNA New API 账号登录。插件会根据账户可用模型及其声明的接口类型，自动添加兼容 OpenAI Images 和 OpenAI Video 的模型。账号启用两步认证时，可以输入验证码或备用码。

3. 在“绘图”中选择默认模型，然后在对话里试试：

   > 画一张雨后霓虹街道的电影感插画。

模型会根据对话内容决定是否调用绘图工具。视频生成则通过创建任务和查询状态获取结果。

## 配置与使用

### 账号与密钥

首次连接会在 New API 中创建名为 `deepImage` 的 API 密钥，后续连接会尝试复用。新密钥不设置独立额度或过期时间，调用使用账户额度，可在 New API 中管理。密钥保存在 Harness 凭据服务中，登录密码不会保存。

登录后，设置页显示账号、最近一次获取的余额及更新时间。会话有效时可以刷新余额；会话过期或预览重启后，重新登录即可刷新。站点未返回头像时，卡片使用账号名称首字作为头像。

### 服务商与超时

登录后可在“绘图”或“视频”选项卡中添加、编辑服务商。填写 API 地址、模型 ID 和凭据引用；API Key 可保存到 Harness 凭据服务，也可复用已有凭据引用。自动配置会保留已有服务商。

在服务商编辑页面可设置该 API 的请求超时，单位为秒。留空时沿用原有全局 `timeoutMs` 配置；全局未设置时默认为 60 秒。图片生成通常需要较长时间，可按需调高。

不同服务商的协议和模型参数可能不同，可在高级设置中调整请求体和响应字段路径；自动接入仅覆盖上述兼容接口。New API 视频任务完成后，插件会下载视频并作为附件返回，大小上限为 200 MB。

图片生成进度根据等待时间估算，最多显示 95%，并非服务商返回的实际进度；生成完成或失败以服务商的结果为准。

更多配置、开发与调试说明见 [详细文档](README.zh.md)。

## 打包与发布

```sh
mkdir -p dist
npm run pack:plugin
```

生成的 `.tgz` 可以通过 `dsh plugin --profile web add ./dsh-media-generation-0.1.0.tgz` 安装。已有 Release 不一定包含本分支的最新功能，请以 Release 对应的版本为准。

发布时，先更新 `package.json` 的版本号并提交，再推送与版本一致的 Git 标签（例如 `v0.1.0`）。GitHub Actions 会打包并创建包含 `.tgz` 的 Release。私有仓库的 Release 和安装包遵循仓库访问权限。

## 许可证

[MIT](LICENSE)
