# deepImage

一个 DeepSeek Harness bundle，提供 `list_media_providers`、`generate_image`、`generate_video` 和 `check_video_task` 工具。服务商列表由插件配置决定；每个 provider 有独立 ID、端点、模型和 API Key 引用。工具参数只接受已配置的 provider ID，不接受模型临时传入的 API URL。

## API Key

配置使用 `apiKeyEnv` 保存凭据引用，不把明文 Key 写入 `cordis.patch.yml`。可以在启动 DSH 的进程环境中设置引用对应的环境变量，例如：

```sh
export OPENAI_API_KEY='你的绘图服务商密钥'
export ARK_API_KEY='你的视频服务商密钥'
```

也可接入 DSH 凭据存储。DeepSeek API Key 用于 DeepSeek 模型请求；绘图/视频服务通常需要各自的服务商 Key。

插件通过 `ctx.credentials.resolve()` 在每次请求前读取当前密钥。Key 不会写入模型工具输出或普通日志。请求不跟随 HTTP 重定向；非本机服务默认要求 HTTPS。仅需临时调试时，可在该服务商的高级设置中明确开启 `allowInsecureHttp`；HTTP 会明文传输密钥，请在调试结束后关闭。

## 添加服务商

在 Harness 的「设置 → deepImage」页面添加、编辑或删除服务商，也可以在 `cordis.patch.yml` 的 `imageProviders` / `videoProviders` 中配置。页面输入的 API Key 通过 Harness 凭据服务保存，留空则使用对应的已有凭据引用。服务商的 REST API 形状并不统一，因此自定义服务商通过 `requestBody` 和响应字段路径适配，不运行用户提供的代码。

在绘图服务商列表中选择「设为默认」后，可以直接在对话中说“画一张……”；模型可自动调用绘图工具并使用默认服务商。只有一个绘图服务商时，也会自动使用它；多个服务商且没有默认值时，需要先选择默认服务商。模型对具体请求的工具选择仍可能受其能力和上下文影响。

`requestBody` 中可使用 `{{model}}`、`{{prompt}}`、`{{size}}`、`{{quality}}`、`{{count}}`、`{{duration}}`、`{{ratio}}` 和 `{{resolution}}` 占位符。若占位符独占一个值，插件保留原有 JSON 类型；否则替换为字符串。

图片服务商响应支持配置 `imageUrlPath` 或 `imageBase64Path`。base64 图片会通过 DSH 的 `ctx.attachments` 校验并保存为持久附件；URL 形式会返回服务商链接，链接的有效期由服务商决定。

视频服务商需提供创建任务端点、包含 `{taskId}` 的查询端点模板，以及响应路径：`taskIdPath`、`statusPath`、`videoUrlPath`。`generate_video` 只负责提交任务；任务生成时间因服务商而异，之后调用 `check_video_task` 查询进度和结果。

## 安装与运行

在本目录执行：

```sh
dsh plugin --profile media-dev add .
dsh --profile media-dev --dump-config
dsh --profile media-dev
```

profile 中的配置层需要将该 bundle 加入 agent 实际使用的工具组合。安装 bundle 后重启 profile。若使用当前 Harness 源码仓库开发，按照官方“第一个插件”和“打包与安装插件”教程加载/安装此 bundle。

本仓库安装了调试用的 Harness CLI，可使用隔离的调试目录启动：

```sh
pnpm install
export DSH_HOME="$PWD/.dsh-dev"
pnpm exec dsh --profile media-dev --from-default-profile web --dump-config
pnpm exec dsh plugin --profile media-dev add .
pnpm exec dsh --profile media-dev
```

创建 profile 和安装 bundle 只需执行一次。页面中的媒体设置保存在该 profile，调试目录不应提交到版本库。改动 Host 代码后重启 DSH。

## 当前适配方式

- 图片：通用 JSON 图片生成接口，默认请求形状兼容 OpenAI Images；响应 URL 或 base64 路径可配置。
- 视频：通用异步 JSON 任务接口，默认请求形状兼容 Ark Seedance；创建请求、任务查询和响应路径可配置。
- 不同服务商仍需按其官方 API 文档配置请求体、认证头和响应路径。添加凭据不能自动让不兼容的 API 变成兼容接口。

DeepSeek Harness 处于 developer preview，发布前应在目标 DSH 版本上验证配置与 API 行为，并收窄 `engines.dsh` 范围。
