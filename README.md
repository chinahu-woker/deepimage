# deepImage

deepImage 是一个 DeepSeek Harness 插件，为对话接入可配置的图片和视频生成 API。可以在设置页管理多个服务商，使用自然语言请求绘图，并查询异步视频任务。

## 安装

需要 DeepSeek Harness、Node.js 和 pnpm。当前开发环境验证的 Harness 版本为 `0.2.1-rc.2`；Harness 仍处于预览阶段，不同版本的插件 API 可能存在差异。

从仓库的 Releases 下载 `dsh-media-generation-0.1.0.tgz`，然后在下载目录运行：

```sh
dsh plugin --profile web add ./dsh-media-generation-0.1.0.tgz
dsh --profile web
```

如果使用其他 profile，将命令中的 `web` 替换为实际名称。插件安装到正在运行的 profile 后，需要重启该 profile。私有仓库的安装包仅对有仓库访问权限的用户可用。

也可以从本地源码安装（克隆私有仓库时需使用有访问权限的 GitHub 账号）：

```sh
git clone https://github.com/chinahu-woker/deepimage.git
cd deepimage
dsh plugin --profile web add .
```

## 配置与使用

打开 Harness 的 **设置 → deepImage**，在“绘图”或“视频”选项卡中添加服务商。填写 API 地址、模型 ID 和凭据引用；API Key 可以在页面中写入 Harness 凭据服务，或复用已有的凭据引用。

在绘图服务商卡片的更多操作中选择“设为默认”，之后可以直接在对话中说“画一张……”。模型会根据请求决定是否调用绘图工具。视频生成采用异步任务：先创建任务，再查询状态和结果。

“生成超时”字段用于设置单次生成请求的等待上限（秒），默认 180 秒；图片生成通常需要较长时间，可按需调高。该值也可在 profile 的 `cordis.patch.yml` 中通过 `timeoutMs`（毫秒）配置。

不同服务商的 API 协议可能不同，需要按其文档调整高级设置中的请求体和响应字段路径。HTTP 仅用于明确启用的临时调试，密钥会通过网络明文传输。

更多配置、开发和调试细节见 [中文说明](README.zh.md)。

## 从源码构建安装包

```sh
mkdir -p dist
npm run pack:plugin
```

生成的 `.tgz` 可以用上面的 `dsh plugin ... add` 命令安装。

发布时，先更新 `package.json` 的版本号并提交，再推送与版本一致的 Git 标签（例如 `v0.1.0`）。仓库的 GitHub Actions 会打包并创建包含 `.tgz` 的 Release。私有仓库的 Release 和安装包遵循仓库访问权限。

## 许可证

[MIT](LICENSE)
