import { Service } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

const apiBase = 'https://api.github.com/repos/chinahu-woker/deepimage'
const allowedDownloadHosts = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
const maxArchiveBytes = 40 * 1024 * 1024

export const updateCodec = { mode: 'strict', typeSymbol: 'deepimage#update-request', create: () => ({ parse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['action', 'version'].includes(key)) || !['status', 'check', 'prepare'].includes(value.action) || (value.action === 'prepare' ? typeof value.version !== 'string' : value.version !== undefined)) throw new Error('Invalid update request.')
  return value
} }) }
export const updateDescriptor = { id: 'deepimage/update-request', service: 'deepImageUpdate', namespace: 'deepImageUpdate', method: 'request', invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: updateCodec }], result: { mode: 'strict', typeSymbol: 'deepimage#update-response', create: () => ({ parse: value => value }) } }

function stableVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) return null
  const parts = match.slice(1).map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}
function compareVersions(a, b) {
  const x = stableVersion(a), y = stableVersion(b)
  if (!x || !y) throw new Error('当前版本格式无法检查更新。')
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
  return 0
}
async function limitedBody(response, maxBytes) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) throw new Error('更新文件超过大小限制。')
  if (!response.body) throw new Error('更新服务器返回空内容。')
  const chunks = []; let total = 0
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > maxBytes) { await response.body.cancel?.().catch(() => {}); throw new Error('更新文件超过大小限制。') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export class DeepImageUpdater extends Service {
  constructor(ctx) {
    super(ctx, 'deepImageUpdate')
    this.typertRemote = Object.freeze({ service: this, serviceKey: this.name, namespace: this.name })
  }
  async installed() {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const edition = manifest.deepImageEdition
    if (!['open-source', 'newapi'].includes(edition) || !stableVersion(manifest.version)) throw new Error('插件版本信息无效。')
    const bundles = await this.ctx.pluginManager.listBundles()
    const bundle = bundles.find(item => item.name === 'dsh-media-generation' && item.installed)
    if (!bundle) throw new Error('当前配置不是可更新的插件安装。')
    return { edition, version: manifest.version, linked: bundle.source?.startsWith('link:') === true, enabled: bundle.enabled }
  }
  async fetchGithub(url, accept, redirects = 0) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !allowedDownloadHosts.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error('更新地址不受信任。')
    const response = await fetch(parsed, {
      redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { Accept: accept, 'User-Agent': 'deepImage-updater', ...(parsed.hostname === 'api.github.com' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirects >= 4) throw new Error('更新下载重定向无效。')
      await response.body?.cancel()
      return this.fetchGithub(new URL(location, parsed).href, accept, redirects + 1)
    }
    if (!response.ok) {
      await response.body?.cancel()
      if (parsed.hostname === 'api.github.com' && (response.status === 403 || response.status === 429)) {
        const error = new Error('GitHub 匿名请求暂时受限。')
        error.code = 'GITHUB_RATE_LIMIT'
        throw error
      }
      if (response.status === 404) throw new Error('无法访问公开更新仓库，请稍后重试。')
      throw new Error(`更新服务器请求失败（HTTP ${response.status}）。`)
    }
    return response
  }
  async latestFromPages(info) {
    const base = 'https://github.com/chinahu-woker/deepimage/releases'
    const prefix = info.edition === 'newapi' ? 'newapi-v' : 'v'
    const candidates = []
    let page = 1
    for (; page <= 10; page++) {
      const response = await this.fetchGithub(`${base}?page=${page}`, 'text/html')
      const html = (await limitedBody(response, 4 * 1024 * 1024)).toString('utf8')
      const sections = html.match(/<section\b[^>]*\bid="release-[^"]+"[^>]*>[\s\S]*?<\/section>/g) || []
      for (const section of sections) {
        if (/>\s*(?:Pre-release|Prerelease)\s*</i.test(section)) continue
        const match = section.match(/href="\/chinahu-woker\/deepimage\/releases\/tag\/([^"?#]+)"/)
        if (!match) continue
        let tag
        try { tag = decodeURIComponent(match[1]) } catch { continue }
        if (!tag.startsWith(prefix)) continue
        const version = tag.slice(prefix.length)
        if (stableVersion(version)) candidates.push({ tag, version })
      }
      if (!/<a\b[^>]*\brel="next"[^>]*>/i.test(html)) break
    }
    if (page > 10) throw new Error('发布版本过多，请前往 GitHub Release 查看更新。')
    candidates.sort((a, b) => compareVersions(b.version, a.version))
    const latest = candidates[0]
    if (!latest) return null
    const assets = await this.fetchGithub(`${base}/expanded_assets/${encodeURIComponent(latest.tag)}`, 'text/html')
    const html = (await limitedBody(assets, 4 * 1024 * 1024)).toString('utf8')
    const names = [`deepimage-${info.edition}-${latest.version}.tgz`, ...(info.edition === 'open-source' ? [`dsh-media-generation-${latest.version}.tgz`] : [])]
    const rows = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) || []
    for (const name of names) {
      const href = `/chinahu-woker/deepimage/releases/download/${latest.tag}/${name}`
      const row = rows.find(item => item.includes(`href="${href}"`))
      const digest = row?.match(/sha256:([a-f0-9]{64})/)?.[1]
      if (digest) return { version: latest.version, name, digest, size: null, tag: latest.tag }
    }
    throw new Error('最新版本的安装包缺失或无法校验，请联系维护人员。')
  }
  async latest(info) {
    let releases
    try {
      const response = await this.fetchGithub(`${apiBase}/releases?per_page=100`, 'application/vnd.github+json')
      releases = JSON.parse((await limitedBody(response, 4 * 1024 * 1024)).toString('utf8'))
    } catch (error) {
      if (error.code === 'GITHUB_RATE_LIMIT') return this.latestFromPages(info)
      throw error
    }
    if (!Array.isArray(releases)) throw new Error('更新版本信息无效。')
    const prefix = info.edition === 'newapi' ? 'newapi-v' : 'v'
    const candidates = []
    for (const release of releases) {
      if (release.draft || release.prerelease || typeof release.tag_name !== 'string' || !release.tag_name.startsWith(prefix)) continue
      const version = release.tag_name.slice(prefix.length)
      if (!stableVersion(version)) continue
      const name = `deepimage-${info.edition}-${version}.tgz`
      const legacy = info.edition === 'open-source' ? `dsh-media-generation-${version}.tgz` : ''
      const asset = Array.isArray(release.assets) ? release.assets.find(item => item.name === name || item.name === legacy) : undefined
      candidates.push({ version, asset, tag: release.tag_name })
    }
    candidates.sort((a, b) => compareVersions(b.version, a.version))
    const latest = candidates[0]
    if (!latest) return null
    const asset = latest.asset
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxArchiveBytes || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('最新版本的安装包缺失或无法校验，请联系维护人员。')
    return { version: latest.version, name: asset.name, size: asset.size, digest: asset.digest.slice(7), tag: latest.tag }
  }
  async request(input) {
    if (this.ctx.invocation?.peer?.principal?.kind !== 'owner') throw new Error('更新插件仅对本机用户开放。')
    const info = await this.installed()
    if (input.action === 'status') return info
    if (info.linked) throw new Error('当前为本地开发链接，请更新源码后重启开发预览。')
    const latest = await this.latest(info)
    if (!latest) throw new Error('没有找到可验证的版本，请检查 Release 安装包。')
    const newer = compareVersions(latest.version, info.version) > 0
    if (input.action === 'check') return { ...info, latest: latest.version, available: newer }
    if (!newer || latest.version !== input.version) throw new Error('更新版本已变化，请重新检查。')
    const url = `https://github.com/chinahu-woker/deepimage/releases/download/${encodeURIComponent(latest.tag)}/${encodeURIComponent(latest.name)}`
    const response = await this.fetchGithub(url, 'application/octet-stream')
    const bytes = await limitedBody(response, maxArchiveBytes)
    if ((latest.size !== null && bytes.length !== latest.size) || createHash('sha256').update(bytes).digest('hex') !== latest.digest) throw new Error('更新包校验失败，请稍后重试。')
    const directory = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'deepimage-updates')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `deepimage-${latest.digest}.tgz`)
    const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    try { await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await rename(temporary, path) }
    catch (error) { try { const { unlink } = await import('node:fs/promises'); await unlink(temporary) } catch {} throw error }
    return { path, version: latest.version, enabled: info.enabled }
  }
}
