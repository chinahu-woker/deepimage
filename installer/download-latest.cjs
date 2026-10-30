'use strict'

const { createHash } = require('node:crypto')
const { writeFile, rename, unlink } = require('node:fs/promises')

const repo = 'chinahu-woker/deepimage'
const api = `https://api.github.com/repos/${repo}`
const hosts = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
const maxBytes = 40 * 1024 * 1024
const maxMetadataBytes = 4 * 1024 * 1024

function versionParts(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null
  const parts = value.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}
function compare(a, b) {
  const x = versionParts(a), y = versionParts(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
  return 0
}
async function request(url, accept, fetcher, depth = 0) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error('下载地址不受信任。')
  const response = await fetcher(parsed, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Accept: accept, 'User-Agent': 'deepImage-installer', ...(parsed.hostname === 'api.github.com' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) } })
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location || depth >= 4) throw new Error('下载重定向无效。')
    await response.body?.cancel()
    return request(new URL(location, parsed).href, accept, fetcher, depth + 1)
  }
  if (!response.ok) {
    await response.body?.cancel()
    if (parsed.hostname === 'api.github.com' && [403, 429].includes(response.status)) { const error = new Error('GitHub 请求受限'); error.code = 'RATE_LIMIT'; throw error }
    throw new Error(`无法获取发布版本（HTTP ${response.status}）。`)
  }
  return response
}
async function body(response, limit) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) throw new Error('下载文件超过大小限制。')
  if (!response.body) throw new Error('下载服务器返回空内容。')
  let total = 0
  const chunks = []
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('下载文件超过大小限制。') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function selectLatest(releases, edition) {
  const prefix = edition === 'newapi' ? 'newapi-v' : 'v'
  const candidates = []
  for (const release of releases) {
    if (release.draft || release.prerelease || typeof release.tag_name !== 'string' || !release.tag_name.startsWith(prefix)) continue
    const version = release.tag_name.slice(prefix.length)
    if (versionParts(version)) candidates.push({ release, version })
  }
  candidates.sort((a, b) => compare(b.version, a.version))
  return candidates[0] || null
}
async function fromPages(edition, fetcher) {
  const releases = []
  let page = 1
  for (; page <= 10; page++) {
    const response = await request(`https://github.com/${repo}/releases?page=${page}`, 'text/html', fetcher)
    const html = (await body(response, maxMetadataBytes)).toString('utf8')
    const sections = html.match(/<section\b[^>]*\bid="release-[^"]+"[^>]*>[\s\S]*?<\/section>/g) || []
    for (const section of sections) {
      if (/>\s*(?:Pre-release|Prerelease)\s*</i.test(section)) continue
      const match = section.match(/href="\/chinahu-woker\/deepimage\/releases\/tag\/([^"?#]+)"/)
      if (match) { try { releases.push({ tag_name: decodeURIComponent(match[1]) }) } catch {} }
    }
    if (!/<a\b[^>]*\brel="next"[^>]*>/i.test(html)) break
  }
  if (page > 10) throw new Error('发布版本过多，请前往 GitHub 查看。')
  const selected = selectLatest(releases, edition)
  if (!selected) throw new Error('没有找到可用的插件版本。')
  const { release, version } = selected
  const response = await request(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(release.tag_name)}`, 'text/html', fetcher)
  const html = (await body(response, maxMetadataBytes)).toString('utf8')
  const name = `deepimage-${edition}-${version}.tgz`
  const href = `/${repo}/releases/download/${release.tag_name}/${name}`
  const row = (html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) || []).find(value => value.includes(`href="${href}"`))
  const digest = row?.match(/sha256:([a-f0-9]{64})/)?.[1]
  if (!digest) throw new Error('最新版本的安装包缺失或无法校验。')
  return { tag: release.tag_name, version, name, digest, size: null }
}
async function latest(edition, fetcher = fetch) {
  if (!['open-source', 'newapi'].includes(edition)) throw new Error('安装版本无效。')
  let releases = []
  try {
    for (let page = 1; page <= 10; page++) {
      const response = await request(`${api}/releases?per_page=100&page=${page}`, 'application/vnd.github+json', fetcher)
      const data = JSON.parse((await body(response, maxMetadataBytes)).toString('utf8'))
      if (!Array.isArray(data)) throw new Error('发布版本信息无效。')
      releases.push(...data)
      if (data.length < 100) break
      if (page === 10) throw new Error('发布版本过多，请前往 GitHub 查看。')
    }
  } catch (error) {
    if (error.code === 'RATE_LIMIT') return fromPages(edition, fetcher)
    throw error
  }
  const selected = selectLatest(releases, edition)
  if (!selected) throw new Error('没有找到可用的插件版本。')
  const { release, version } = selected
  const name = `deepimage-${edition}-${version}.tgz`
  const asset = Array.isArray(release.assets) && release.assets.find(item => item.name === name)
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxBytes || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('最新版本的安装包缺失或无法校验。')
  return { tag: release.tag_name, version, name, size: asset.size, digest: asset.digest.slice(7) }
}
async function download(edition, path, fetcher = fetch) {
  const release = await latest(edition, fetcher)
  const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(release.name)}`
  const bytes = await body(await request(url, 'application/octet-stream', fetcher), maxBytes)
  if ((release.size !== null && bytes.length !== release.size) || createHash('sha256').update(bytes).digest('hex') !== release.digest) throw new Error('安装包校验失败，请稍后重试。')
  const temporary = `${path}.${process.pid}.tmp`
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
  catch (error) { await unlink(temporary).catch(() => {}); throw error }
  return release.version
}
if (require.main === module) {
  const [, , edition, path] = process.argv
  if (!path) { console.error('缺少安装包保存路径。'); process.exitCode = 1 }
  else download(edition, path).then(version => console.log(`已下载 ${version}。`), error => { console.error(`下载最新插件失败：${error.message || error}`); process.exitCode = 1 })
}
module.exports = { latest, download }
