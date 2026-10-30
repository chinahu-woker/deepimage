import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Service } from '@deepseek-ai/cordis'
import { DeepImageUpdater, updateDescriptor } from './updater.js'

export const name = 'deepImage'
export const inject = ['tools', 'credentials']

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const newApiCodec = { mode: 'strict', typeSymbol: 'deepimage#newapi-request', create: () => ({ parse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['path', 'token', 'body'].includes(key)) || typeof value.path !== 'string' || typeof value.token !== 'string' || (value.body !== null && (typeof value.body !== 'object' || Array.isArray(value.body)))) throw new Error('Invalid New API request.')
  return value
} }) }
const newApiDescriptor = { id: 'deepimage/newapi-request', service: 'deepImageNewApi', namespace: 'deepImageNewApi', method: 'request', invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: newApiCodec }], result: { mode: 'strict', typeSymbol: 'deepimage#newapi-response', create: () => ({ parse: value => value }) } }

class NewApiService extends Service {
  constructor(ctx) {
    super(ctx, 'deepImageNewApi')
    this.typertRemote = Object.freeze({ service: this, serviceKey: this.name, namespace: this.name })
    this.sessionLocks = new Map()
  }
  async withSessionLock(id, action) {
    const previous = this.sessionLocks.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    this.sessionLocks.set(id, current)
    try { return await current } finally {
      if (this.sessionLocks.get(id) === current) this.sessionLocks.delete(id)
    }
  }
  async request(input) {
    if (this.ctx.invocation?.peer?.principal?.kind !== 'owner') throw new Error('New API connection is available only to the host owner.')
    const refresh = input.path === '/api/user/auth/refresh'
    const logout = input.path === '/api/user/auth/logout'
    const forget = input.path === '/api/user/auth/forget'
    const allowed = new Set(['/api/user/login', '/api/user/login/verify', '/api/user/auth/refresh', '/api/user/auth/logout', '/api/user/auth/forget', '/api/user/self', '/api/status', '/api/pricing', '/api/token/search?keyword=deepImage&page_size=100', '/api/token/', '/v1/models'])
    if (!allowed.has(input.path) && !/^\/api\/token\/[1-9]\d*\/key$/.test(input.path)) throw new Error('Unsupported New API request.')
    const post = input.path === '/api/user/login' || input.path === '/api/user/login/verify' || refresh || logout || forget || input.path === '/api/token/' || /^\/api\/token\/[1-9]\d*\/key$/.test(input.path)
    if ((post && !input.body) || (!post && input.body !== null)) throw new Error('Invalid New API request method.')
    if (refresh || logout || forget) {
      const id = input.body?.userId
      if (!Number.isSafeInteger(id) || id <= 0 || Object.keys(input.body).length !== 1 || input.token) throw new Error('Invalid New API session request.')
      return this.withSessionLock(id, async () => {
        const stored = await this.ctx.credentials.resolve(credentialRef(`DEEPIMAGE_NEWAPI_SESSION_${id}`))
        if (logout || forget) {
          if (logout && stored?.value) await this.fetchNewApi(input, { refreshCookie: stored.value, expectedId: id })
          await this.ctx.credentials.unset(credentialRef(`DEEPIMAGE_NEWAPI_SESSION_${id}`))
          await this.ctx.credentials.unset(credentialRef(`DEEPIMAGE_NEWAPI_${id}`))
          return { success: true }
        }
        if (!stored?.value) throw new Error('未找到可恢复的登录会话，请重新登录。')
        return this.fetchNewApi(input, { refreshCookie: stored.value, expectedId: id })
      })
    }
    return this.fetchNewApi(input)
  }
  async fetchNewApi(input, { refreshCookie, expectedId } = {}) {
    const refresh = input.path === '/api/user/auth/refresh'
    const logout = input.path === '/api/user/auth/logout'
    const post = input.body !== null
    const response = await fetch('https://token.aikna.cn' + input.path, {
      method: post ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}), ...(post ? { 'Content-Type': 'application/json' } : {}), ...(refreshCookie ? { Cookie: `new_api_refresh=${refreshCookie}`, Origin: 'https://token.aikna.cn' } : {}) },
      ...(post ? { body: JSON.stringify(refresh || logout ? {} : input.body) } : {}),
    })
    if (logout && (response.status === 401 || response.status === 403)) return { success: true }
    const sessionAuthenticated = input.token && input.path !== '/v1/models'
    if (!response.ok) throw new Error((refresh || sessionAuthenticated) && response.status === 401 ? '登录会话已失效，请重新登录。' : `New API request failed (HTTP ${response.status}).`)
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > 4 * 1024 * 1024) { await response.body?.cancel(); throw new Error('New API response is too large.') }
    if (!response.body) throw new Error('New API returned an empty response.')
    const chunks = []
    let total = 0
    for await (const chunk of response.body) {
      total += chunk.byteLength
      if (total > 4 * 1024 * 1024) throw new Error('New API response is too large.')
      chunks.push(chunk)
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (logout && result?.success === false) throw new Error(result.message || '退出登录失败，请重试。')
    const login = input.path === '/api/user/login' || input.path === '/api/user/login/verify'
    if ((login || refresh) && result?.success !== false && result?.data?.access_token) {
      const id = result.data.user?.id
      if (!Number.isSafeInteger(id) || id <= 0 || (refresh && id !== expectedId)) throw new Error('New API session account mismatch.')
      const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || '']
      const cookie = cookies.map(value => value.match(/(?:^|,\s*)new_api_refresh=([^;\s,]+)/)?.[1]).find(Boolean)
      if (!cookie || cookie.length > 2048 || !/^[A-Za-z0-9._~%+-]+$/.test(cookie)) throw new Error('未收到有效的登录会话，请检查 New API 配置。')
      const save = () => this.ctx.credentials.set(credentialRef(`DEEPIMAGE_NEWAPI_SESSION_${id}`), cookie)
      if (refresh) await save()
      else await this.withSessionLock(id, save)
    }
    return result
  }
}

function commonProviderFields() {
  return {
    id: Schema.string().required(),
    endpoint: Schema.string().required(),
    model: Schema.string().required(),
    apiKeyEnv: Schema.string().default('MEDIA_API_KEY'),
    authHeader: Schema.string().default('Authorization'),
    authPrefix: Schema.string().default('Bearer '),
    allowInsecureHttp: Schema.boolean().default(false),
    timeoutMs: Schema.natural(),
    requestBody: Schema.any(),
  }
}

const ImageProviderSchema = Schema.object({
  ...commonProviderFields(),
  imageUrlPath: Schema.string().default('data.0.url'),
  imageBase64Path: Schema.string().default('data.0.b64_json'),
  imageMimeType: Schema.string().default('image/png'),
})

const VideoProviderSchema = Schema.object({
  ...commonProviderFields(),
  protocol: Schema.string().default('json'),
  statusEndpointTemplate: Schema.string().required(),
  taskIdPath: Schema.string().default('id'),
  statusPath: Schema.string().default('status'),
  videoUrlPath: Schema.string().default('content.video_url'),
  errorPath: Schema.string().default('error.message'),
  successStatuses: Schema.array(String).default(['succeeded', 'completed']),
  failureStatuses: Schema.array(String).default(['failed', 'error', 'cancelled', 'expired']),
})

export const Config = Schema.object({
  imageProviders: Schema.array(ImageProviderSchema).default([]).volatile(),
  defaultImageProvider: Schema.string().default('').volatile(),
  newApiAccount: Schema.any().default(null).volatile(),
  videoProviders: Schema.array(VideoProviderSchema).default([]).volatile(),
  timeoutMs: Schema.natural().default(DEFAULT_TIMEOUT_MS).volatile(),
  maxImageBytes: Schema.natural().default(DEFAULT_MAX_IMAGE_BYTES),
  maxResponseBytes: Schema.natural().default(DEFAULT_MAX_RESPONSE_BYTES),
})

const toolOutputSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    provider: { type: 'string', required: true },
    message: { type: 'string', required: true },
    taskId: { type: 'string' },
    status: { type: 'string' },
    imageUrl: { type: 'string' },
    videoUrl: { type: 'string' },
    attachment: { type: 'object', additionalProperties: true },
    videoAttachment: { type: 'object', additionalProperties: true },
  },
}

export function apply(ctx, config) {
  ctx.inject(['typert', 'pluginManager'], child => {
    child.plugin(DeepImageUpdater)
    child.typert.register({ package: 'dsh-media-generation-updater', face: 'host', model: {}, schemas: [], invocations: [updateDescriptor] })
  })
  ctx.inject(['typert'], child => {
    child.plugin(NewApiService)
    child.typert.register({ package: 'dsh-media-generation-newapi', face: 'host', model: {}, schemas: [], invocations: [newApiDescriptor] })
  })
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  const availableProviders = (providers, kind) => {
    const account = config.newApiAccount.get()
    const activeId = String(account?.id || '')
    return indexProviders(providers.filter(provider => {
      const idOwner = /^newapi:(\d+):/.exec(provider.id)?.[1]
      const credentialOwner = /^DEEPIMAGE_NEWAPI_(\d+)$/.exec(provider.apiKeyEnv)?.[1]
      return (!idOwner || idOwner === activeId) && (!credentialOwner || credentialOwner === activeId)
    }), kind)
  }
  const imageProviders = () => availableProviders(config.imageProviders.get(), 'image')
  const videoProviders = () => availableProviders(config.videoProviders.get(), 'video')
  const currentTimeoutMs = (provider) => {
    if (Number.isInteger(provider.timeoutMs) && provider.timeoutMs > 0) return Math.min(provider.timeoutMs, 2_147_483_647)
    const raw = typeof config.timeoutMs?.get === 'function' ? config.timeoutMs.get() : config.timeoutMs
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw === 60_000 ? DEFAULT_TIMEOUT_MS : raw, 2_147_483_647) : DEFAULT_TIMEOUT_MS
  }
  const maxImageBytes = config.maxImageBytes || DEFAULT_MAX_IMAGE_BYTES
  const maxResponseBytes = config.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES

  ctx.tools.register(defineTool({
    name: 'list_media_providers',
    description: 'List configured image and video provider IDs before generating media.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      const images = [...imageProviders().keys()].join(', ') || '(none)'
      const configuredDefault = config.defaultImageProvider.get()
      const defaultImage = imageProviders().has(configuredDefault) ? configuredDefault : '(not configured)'
      const videos = [...videoProviders().keys()].join(', ') || '(none)'
      return `Image providers: ${images}\nDefault image provider: ${defaultImage}\nVideo providers: ${videos}`
    },
  }))

  {
    const imageTool = defineTool({
      name: 'generate_image',
      description: 'Generate an image with the configured image model. Use for requests to create or draw pictures, illustrations, posters, covers and visual assets, including Chinese requests such as 生成图片、画一张图、生成海报. Use the user’s description as the prompt. Omit provider to use the configured default; if the user explicitly names a model or provider, use list_media_providers to find the exact matching provider ID when available. Return the generated image. Do not substitute browser, SVG, canvas or code drawing unless the user explicitly requests that format or method. If the call fails, explain the error rather than claiming an image was generated. Do not automatically retry a timeout: the provider may still be processing it.',
      parameters: {
        provider: { type: 'string', description: 'Optional configured image provider ID; omit to use the default.' },
        prompt: { type: 'string', required: true, description: 'Describe the image to create.' },
        size: { type: 'string', description: 'Optional provider-supported size, such as 1024x1024 or 2K.' },
        quality: { type: 'string', description: 'Optional provider-supported quality setting.' },
        count: { type: 'integer', description: 'Number of images, when supported by the provider.' },
      },
      output: {
        schema: toolOutputSchema,
        render: (_args, value) => {
          const blocks = [{ type: 'text', text: value.message }]
          if (value.imageUrl) blocks.push({ type: 'text', text: `Image URL: ${value.imageUrl}` })
          if (value.attachment) blocks.push({ type: 'image', attachment: value.attachment })
          return blocks
        },
      },
      async execute(args, exec) {
        const available = imageProviders()
        const configuredDefault = config.defaultImageProvider.get()
        const requested = args.provider || (available.has(configuredDefault) ? configuredDefault : '') || (available.size === 1 ? available.keys().next().value : '')
        if (!requested) throw new Error('No default image provider is configured. Select one in deepImage settings.')
        const provider = requireProvider(available, requested, 'image')
        const body = makeImageBody(provider, args)
        const response = await requestJson(ctx, provider, provider.endpoint, body, exec.signal, currentTimeoutMs(provider), maxResponseBytes)
        if (response?.error || response?.success === false) {
          const detail = typeof response.error === 'string' ? response.error : response.error?.message || response.message
          throw new Error(`Provider "${provider.id}" reported an image generation error.${typeof detail === 'string' ? ` ${detail.slice(0, 500)}` : ''}`)
        }
        const imageUrl = getPath(response, provider.imageUrlPath)
        const encoded = getPath(response, provider.imageBase64Path)

        if (typeof imageUrl === 'string' && imageUrl.length > 0) {
          return {
            provider: provider.id,
            imageUrl,
            message: `Image generated with ${provider.id}. The provider returned a URL; save it before it expires if the service uses temporary links.`,
          }
        }

        if (typeof encoded !== 'string' || encoded.length === 0) {
          throw new Error(`Provider "${provider.id}" returned neither an image URL nor base64 image data. Check imageUrlPath/imageBase64Path.`)
        }

        const { bytes, mediaType } = decodeImage(encoded, provider.imageMimeType)
        if (bytes.byteLength > maxImageBytes) {
          throw new Error(`Provider "${provider.id}" returned an image larger than the configured ${maxImageBytes}-byte limit.`)
        }
        const attachments = ctx.get('attachments')
        if (!attachments) {
          throw new Error('This provider returned image bytes, but durable image attachments are unavailable in the current DSH profile.')
        }
        const attachment = await attachments.saveImage({ data: bytes, mediaType, name: `${provider.id}-generated` })
        return {
          provider: provider.id,
          attachment,
          message: `Image generated with ${provider.id} and stored as a durable DSH attachment.`,
        }
      },
    })
    ctx.tools.register(imageTool)
    ctx.inject(['systemPrompt'], child => {
      child.systemPrompt.section({
        name: 'deepimage:image-generation',
        order: 3000,
        text: ({ scope }) => {
          if (child.tools.get('generate_image', scope) !== imageTool) return ''
          return 'Image creation: when the user asks for a picture, illustration, poster, cover, or other generated visual, invoke generate_image through the available tool interface (or its provided SDK in PTC mode) using the user’s request. This also applies when generating an image for a document or webpage. Use the configured default unless the user names a model; for a named model, use list_media_providers if available to find its exact provider ID, and never invent an ID. Do not silently replace image generation with browser automation, SVG, canvas, drawing code, or a description. Respect explicit requests for SVG, vector graphics, diagrams, or code-based drawing. If image generation is unavailable or fails, explain the problem; do not claim success or automatically retry a timeout.'
        },
      })
    })
  }

  {
    ctx.tools.register(defineTool({
      name: 'generate_video',
      description: 'Start a video generation task with a configured provider ID. Call list_media_providers to find IDs, then check_video_task with the returned task ID.',
      parameters: {
        provider: { type: 'string', required: true, description: 'Configured video provider ID.' },
        prompt: { type: 'string', required: true, description: 'Describe the video to create.' },
        duration: { type: 'integer', description: 'Requested duration in seconds, if supported.' },
        ratio: { type: 'string', description: 'Aspect ratio, for example 16:9 or 9:16.' },
        resolution: { type: 'string', description: 'Requested resolution, if supported.' },
      },
      output: {
        schema: toolOutputSchema,
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const provider = requireProvider(videoProviders(), args.provider, 'video')
        const body = makeVideoBody(provider, args)
        const response = await requestJson(ctx, provider, provider.endpoint, body, exec.signal, currentTimeoutMs(provider), maxResponseBytes)
        const taskId = getPath(response, provider.taskIdPath)
        if (typeof taskId !== 'string' || taskId.length === 0) {
          throw new Error(`Provider "${provider.id}" did not return a task ID at "${provider.taskIdPath}".`)
        }
        return {
          provider: provider.id,
          taskId,
          status: typeof getPath(response, provider.statusPath) === 'string' && getPath(response, provider.statusPath).trim() ? getPath(response, provider.statusPath) : 'submitted',
          message: `Video task submitted to ${provider.id}. Task ID: ${taskId}. Call check_video_task with this provider and task ID to check progress.`,
        }
      },
    }))

    ctx.tools.register(defineTool({
      name: 'check_video_task',
      description: 'Check a video generation task and return its current state or completed video URL.',
      parameters: {
        provider: { type: 'string', required: true, description: 'The provider ID returned by generate_video.' },
        taskId: { type: 'string', required: true, description: 'The task ID returned by generate_video.' },
      },
      output: {
        schema: toolOutputSchema,
        render: (_args, value) => [{ type: 'text', text: value.message }, ...(value.videoAttachment ? [{ type: 'file', attachment: value.videoAttachment }] : [])],
      },
      async execute(args, exec) {
        const provider = requireProvider(videoProviders(), args.provider, 'video')
        const endpoint = provider.statusEndpointTemplate.replace('{taskId}', encodeURIComponent(args.taskId))
        const response = await requestJson(ctx, provider, endpoint, undefined, exec.signal, currentTimeoutMs(provider), maxResponseBytes, 'GET')
        const status = getPath(response, provider.statusPath)
        const videoUrl = getPath(response, provider.videoUrlPath)
        const providerError = getPath(response, provider.errorPath)

        if (typeof status !== 'string' || !status.trim()) {
          throw new Error(`Provider "${provider.id}" did not return a task status at "${provider.statusPath}".`)
        }
        const normalizedStatus = status.trim().toLowerCase()
        const matchesStatus = statuses => (statuses || []).some(item => typeof item === 'string' && item.trim().toLowerCase() === normalizedStatus)
        if (matchesStatus(provider.successStatuses)) {
          if (provider.protocol === 'newapi-video') {
            const attachment = await saveNewApiVideo(ctx, provider, args.taskId, exec.signal, currentTimeoutMs(provider))
            const path = ctx.get('attachments')?.fileHostPath?.(attachment)
            return { provider: provider.id, taskId: args.taskId, status, videoAttachment: attachment, message: `Video generation completed with ${provider.id}. The video is saved as an attachment.${path ? ` Host file path: ${path}` : ''}` }
          }
          if (typeof videoUrl !== 'string' || videoUrl.length === 0) {
            throw new Error(`Task ${args.taskId} succeeded, but no video URL was found at "${provider.videoUrlPath}".`)
          }
          return {
            provider: provider.id,
            taskId: args.taskId,
            status,
            videoUrl,
            message: `Video generation completed with ${provider.id}. Video URL: ${videoUrl}`,
          }
        }
        if (matchesStatus(provider.failureStatuses)) {
          const detail = typeof providerError === 'string' ? ` Provider error: ${providerError.slice(0, 500)}` : ''
          return {
            provider: provider.id,
            taskId: args.taskId,
            status,
            message: `Video task ${args.taskId} ended with status "${status}".${detail}`,
          }
        }
        const pending = ['queued', 'pending', 'submitted', 'created', 'processing', 'running', 'in_progress', 'in-progress'].includes(normalizedStatus)
        return {
          provider: provider.id,
          taskId: args.taskId,
          status,
          message: `Video task ${args.taskId} ${pending ? `is still ${status}` : `reported an unrecognized status "${status}"`}.${typeof response.progress === 'number' && response.progress >= 0 && response.progress <= 100 ? ` Progress: ${response.progress}%.` : ''} Check again later with check_video_task.`,
        }
      },
    }))
  }
}

async function saveNewApiVideo(ctx, provider, taskId, signal, timeoutMs) {
  const attachments = ctx.get('attachments')
  if (!attachments) throw new Error('Video attachments are unavailable in the current DSH profile.')
  const credential = await ctx.credentials.resolve(credentialRef(provider.apiKeyEnv))
  if (!credential?.value) throw new Error(`No API key is configured for provider "${provider.id}".`)
  const url = provider.statusEndpointTemplate.replace('{taskId}', encodeURIComponent(taskId)) + '/content'
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const requestSignal = AbortSignal.any([signal, timeoutSignal])
  const downloadFailure = error => {
    const failure = requestFailure(error, provider, requestSignal, timeoutSignal, timeoutMs, `Video download timed out after ${timeoutMs} ms.`)
    if (requestSignal.aborted && requestSignal.reason !== timeoutSignal.reason) return failure
    return new Error(`Video task ${taskId} completed, but the download failed: ${failure.message} Check the same task again to download it.`)
  }
  let response
  try { response = await fetch(url, { headers: { [provider.authHeader]: `${provider.authPrefix}${credential.value}` }, signal: requestSignal, redirect: 'error' }) }
  catch (error) { throw downloadFailure(error) }
  if (!response.ok || !response.body) throw downloadFailure(new Error(response.status === 408 || response.status === 504 ? `The provider or gateway reported a timeout (HTTP ${response.status}).` : `HTTP ${response.status}.`))
  const type = (response.headers.get('content-type') || '').toLowerCase()
  if (!type.startsWith('video/') && !type.startsWith('application/octet-stream')) { await response.body.cancel(); throw new Error('The video endpoint did not return a video file.') }
  const limit = 200 * 1024 * 1024
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) { await response.body.cancel(); throw new Error('Generated video exceeds the 200 MB download limit.') }
  async function* chunks() {
    let total = 0
    for await (const chunk of response.body) {
      total += chunk.byteLength
      if (total > limit) throw new Error('Generated video exceeds the 200 MB download limit.')
      yield chunk
    }
  }
  try { return await attachments.saveFileStream({ data: chunks(), signal: requestSignal, name: 'generated-video.mp4' }) }
  catch (error) { throw downloadFailure(error) }
}

function indexProviders(providers, kind) {
  const indexed = new Map()
  for (const provider of providers) {
    validateEndpoint(provider.endpoint, `${kind} provider "${provider.id}" endpoint`, provider.allowInsecureHttp)
    if (indexed.has(provider.id)) throw new Error(`Duplicate ${kind} provider ID: ${provider.id}`)
    if (!provider.id.trim()) throw new Error(`${kind} provider IDs must not be empty.`)
    if (!provider.apiKeyEnv.trim()) throw new Error(`${kind} provider "${provider.id}" needs apiKeyEnv.`)
    if (kind === 'video') {
      const sample = provider.statusEndpointTemplate.replace('{taskId}', 'sample-task')
      if (sample === provider.statusEndpointTemplate) throw new Error(`Video provider "${provider.id}" statusEndpointTemplate must contain {taskId}.`)
      validateEndpoint(sample, `video provider "${provider.id}" status endpoint`, provider.allowInsecureHttp)
    }
    indexed.set(provider.id, provider)
  }
  return indexed
}

function requireProvider(indexed, id, kind) {
  const provider = indexed.get(id)
  if (!provider) throw new Error(`Unknown ${kind} provider "${id}". Choose one of: ${[...indexed.keys()].join(', ') || '(none configured)'}.`)
  return provider
}

function validateEndpoint(value, label, allowInsecureHttp = false) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`)
  }
  const localHttp = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !localHttp && !(url.protocol === 'http:' && allowInsecureHttp === true)) {
    throw new Error(`${label} must use HTTPS unless insecure HTTP is explicitly enabled for this provider.`)
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not include URL credentials or a fragment.`)
  }
}

function requestFailure(error, provider, requestSignal, timeoutSignal, timeoutMs, timeoutMessage) {
  if (requestSignal.aborted) {
    if (timeoutSignal.aborted && requestSignal.reason === timeoutSignal.reason) return new Error(timeoutMessage || `Provider "${provider.id}" request timed out after ${timeoutMs} ms. The remote task may still be running.`)
    return requestSignal.reason || error
  }
  if (error instanceof TypeError) return new Error(`Connection to provider "${provider.id}" failed while sending or reading the response.`)
  return error
}

async function requestJson(ctx, provider, endpoint, body, signal, timeoutMs, maxResponseBytes, method = 'POST') {
  const credential = await ctx.credentials.resolve(credentialRef(provider.apiKeyEnv))
  if (!credential?.value) throw new Error(`No API key is configured for provider "${provider.id}". Set credential reference ${provider.apiKeyEnv}.`)

  const headers = {
    Accept: 'application/json',
    [provider.authHeader]: `${provider.authPrefix}${credential.value}`,
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const requestSignal = AbortSignal.any([signal, timeoutSignal])
  const init = {
    method,
    headers,
    redirect: 'error',
    signal: requestSignal,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(endpoint, init)
  } catch (error) {
    throw requestFailure(error, provider, requestSignal, timeoutSignal, timeoutMs)
  }
  if (!response.ok) {
    if (response.status === 408 || response.status === 504) throw new Error(`Provider "${provider.id}" or its gateway reported a timeout (HTTP ${response.status}); the remote task may still be running.`)
    throw new Error(`Provider "${provider.id}" returned HTTP ${response.status}. Check its API key, endpoint, quota, and request format.`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('json')) {
    throw new Error(`Provider "${provider.id}" returned a non-JSON response.`)
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel()
    throw new Error(`Provider "${provider.id}" response exceeds the configured ${maxResponseBytes}-byte limit.`)
  }
  try {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Empty response body')
    const chunks = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxResponseBytes) {
        await reader.cancel()
        throw new Error(`Provider "${provider.id}" response exceeds the configured ${maxResponseBytes}-byte limit.`)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    try { return JSON.parse(new TextDecoder().decode(bytes)) }
    catch (error) { if (error instanceof SyntaxError) throw new Error(`Provider "${provider.id}" returned invalid JSON.`); throw error }
  } catch (error) {
    throw requestFailure(error, provider, requestSignal, timeoutSignal, timeoutMs)
  }
}

function makeImageBody(provider, args) {
  const values = { model: provider.model, prompt: args.prompt, size: args.size, quality: args.quality, count: args.count }
  if (provider.requestBody !== undefined) return interpolate(provider.requestBody, values)
  return {
    model: provider.model,
    prompt: args.prompt,
    ...(args.size ? { size: args.size } : {}),
    ...(args.quality ? { quality: args.quality } : {}),
    ...(args.count ? { n: args.count } : {}),
  }
}

function makeVideoBody(provider, args) {
  if (provider.protocol === 'newapi-video') return { model: provider.model, prompt: args.prompt, ...(args.duration !== undefined ? { seconds: String(args.duration) } : {}), ...(args.resolution && /^\d+x\d+$/.test(args.resolution) ? { size: args.resolution } : {}) }
  const values = {
    model: provider.model,
    prompt: args.prompt,
    duration: args.duration,
    ratio: args.ratio,
    resolution: args.resolution,
  }
  if (provider.requestBody !== undefined) return interpolate(provider.requestBody, values)
  return {
    model: provider.model,
    content: [{ type: 'text', text: args.prompt }],
    ...(args.duration !== undefined ? { duration: args.duration } : {}),
    ...(args.ratio ? { ratio: args.ratio } : {}),
    ...(args.resolution ? { resolution: args.resolution } : {}),
  }
}

function interpolate(value, values) {
  if (Array.isArray(value)) return value.map(item => interpolate(item, values))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, interpolate(item, values)])
      .filter(([, item]) => item !== undefined))
  }
  if (typeof value !== 'string') return value
  const exact = value.match(/^\{\{(model|prompt|size|quality|count|duration|ratio|resolution)\}\}$/)
  if (exact) return values[exact[1]]
  return value.replace(/\{\{(model|prompt|size|quality|count|duration|ratio|resolution)\}\}/g, (_match, key) => String(values[key] ?? ''))
}

function getPath(value, path) {
  if (!path) return undefined
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  return parts.reduce((current, key) => current == null ? undefined : current[key], value)
}

function decodeImage(encoded, fallbackMimeType) {
  let data = encoded
  let mediaType = fallbackMimeType
  const dataUrl = encoded.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s)
  if (dataUrl) {
    mediaType = dataUrl[1].toLowerCase()
    data = dataUrl[2]
  }
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) throw new Error(`Unsupported generated image type "${mediaType}".`)
  let bytes
  try {
    bytes = new Uint8Array(Buffer.from(data, 'base64'))
  } catch {
    throw new Error('Provider returned invalid base64 image data.')
  }
  if (bytes.byteLength === 0) throw new Error('Provider returned empty image data.')
  return { bytes, mediaType }
}
