import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DeepImageUpdater, updateDescriptor } from './updater.js'

export const name = 'deepImage'
export const inject = ['tools', 'credentials']

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function commonProviderFields() {
  return {
    id: Schema.string().required(),
    endpoint: Schema.string().required(),
    model: Schema.string().required(),
    apiKeyEnv: Schema.string().default('MEDIA_API_KEY'),
    authHeader: Schema.string().default('Authorization'),
    authPrefix: Schema.string().default('Bearer '),
    allowInsecureHttp: Schema.boolean().default(false),
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
  },
}

export function apply(ctx, config) {
  ctx.inject(['typert', 'pluginManager'], child => {
    child.plugin(DeepImageUpdater)
    child.typert.register({ package: 'dsh-media-generation-updater', face: 'host', model: {}, schemas: [], invocations: [updateDescriptor] })
  })
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  const imageProviders = () => indexProviders(config.imageProviders.get(), 'image')
  const videoProviders = () => indexProviders(config.videoProviders.get(), 'video')
  const currentTimeoutMs = () => {
    const raw = typeof config.timeoutMs?.get === 'function' ? config.timeoutMs.get() : config.timeoutMs
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
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
      const defaultImage = config.defaultImageProvider.get() || '(not configured)'
      const videos = [...videoProviders().keys()].join(', ') || '(none)'
      return `Image providers: ${images}\nDefault image provider: ${defaultImage}\nVideo providers: ${videos}`
    },
  }))

  {
    ctx.tools.register(defineTool({
      name: 'generate_image',
      description: 'When the user asks you to draw or generate an image, call this tool directly using their description. Omit provider to use the configured default. Supply a provider only when the user explicitly chooses one. Return the generated image to the user. If a request times out, do not retry automatically: the provider may still be processing it. Report the timeout and let the user decide whether to try again.',
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
        const requested = args.provider || config.defaultImageProvider.get() || (available.size === 1 ? available.keys().next().value : '')
        if (!requested) throw new Error('No default image provider is configured. Select one in deepImage settings.')
        const provider = requireProvider(available, requested, 'image')
        const body = makeImageBody(provider, args)
        const response = await requestJson(ctx, provider, provider.endpoint, body, exec.signal, currentTimeoutMs(), maxResponseBytes)
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
    }))
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
        const response = await requestJson(ctx, provider, provider.endpoint, body, exec.signal, currentTimeoutMs(), maxResponseBytes)
        const taskId = getPath(response, provider.taskIdPath)
        if (typeof taskId !== 'string' || taskId.length === 0) {
          throw new Error(`Provider "${provider.id}" did not return a task ID at "${provider.taskIdPath}".`)
        }
        return {
          provider: provider.id,
          taskId,
          status: 'queued',
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
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const provider = requireProvider(videoProviders(), args.provider, 'video')
        const endpoint = provider.statusEndpointTemplate.replace('{taskId}', encodeURIComponent(args.taskId))
        const response = await requestJson(ctx, provider, endpoint, undefined, exec.signal, currentTimeoutMs(), maxResponseBytes, 'GET')
        const status = getPath(response, provider.statusPath)
        const videoUrl = getPath(response, provider.videoUrlPath)
        const providerError = getPath(response, provider.errorPath)

        if (typeof status !== 'string') {
          throw new Error(`Provider "${provider.id}" did not return a task status at "${provider.statusPath}".`)
        }
        if (provider.successStatuses.includes(status)) {
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
        if (provider.failureStatuses.includes(status)) {
          const detail = typeof providerError === 'string' ? ` Provider error: ${providerError.slice(0, 500)}` : ''
          return {
            provider: provider.id,
            taskId: args.taskId,
            status,
            message: `Video task ${args.taskId} ended with status "${status}".${detail}`,
          }
        }
        return {
          provider: provider.id,
          taskId: args.taskId,
          status,
          message: `Video task ${args.taskId} is still ${status}. Check again later with check_video_task.`,
        }
      },
    }))
  }
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

async function requestJson(ctx, provider, endpoint, body, signal, timeoutMs, maxResponseBytes, method = 'POST') {
  const credential = await ctx.credentials.resolve(credentialRef(provider.apiKeyEnv))
  if (!credential?.value) throw new Error(`No API key is configured for provider "${provider.id}". Set credential reference ${provider.apiKeyEnv}.`)

  const headers = {
    Accept: 'application/json',
    [provider.authHeader]: `${provider.authPrefix}${credential.value}`,
  }
  const init = {
    method,
    headers,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(endpoint, init)
  } catch (error) {
    if (signal.aborted) throw error
    if (error?.name === 'TimeoutError') throw new Error(`Provider "${provider.id}" timed out after ${timeoutMs} ms.`)
    throw new Error(`Could not reach provider "${provider.id}" (${error?.name ?? 'network error'}).`)
  }
  if (!response.ok) throw new Error(`Provider "${provider.id}" returned HTTP ${response.status}. Check its API key, endpoint, quota, and request format.`)

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
        throw new Error('Response body limit exceeded')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`Provider "${provider.id}" returned invalid JSON or exceeded the response size limit.`)
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
