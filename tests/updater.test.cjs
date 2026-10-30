const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')

// Run the real updater with simulated Harness services and GitHub responses.
const source = fs.readFileSync(path.join(__dirname, '../src/updater.js'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/export (class|const) /g, '$1 ')
  .replace("await readFile(new URL('../package.json', import.meta.url), 'utf8')", "await readFile('manifest')")
  + '\nglobalThis.DeepImageUpdater = DeepImageUpdater'
const archive = Buffer.from('verified test archive')
const digest = createHash('sha256').update(archive).digest('hex')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deepimage-updater-test-'))
let edition = 'newapi', linked = false, incorrectDigest = false, badRedirect = false, incomplete = false, rateLimited = false
const requests = []
const credentials = { async resolve() { throw new Error('The public updater must not read saved credentials') } }
const pluginManager = {
  async listBundles() {
    return [{ name: 'dsh-media-generation', installed: true, enabled: true, source: linked ? 'link:/development' : 'file:/old.tgz' }]
  },
}
class Service { constructor(ctx, name) { this.ctx = ctx; this.name = name } }
const context = {
  Service, createHash, homedir: () => temporary, join: path.join,
  mkdir: fsp.mkdir, rename: fsp.rename, writeFile: fsp.writeFile,
  readFile: async () => JSON.stringify({ version: '0.1.1', deepImageEdition: edition }),
  Buffer, URL, Set, Map, Number, Object, Array, String, JSON, Error, AbortSignal, Math,
  process: { env: { DSH_HOME: temporary }, pid: 123 },
  fetch: async (url, options) => {
    const target = String(url)
    requests.push({ url: target, headers: options.headers })
    if (target.includes('api.github.com') && target.includes('/releases?')) {
      if (rateLimited) return new Response('', { status: 403 })
      const asset = name => ({ name, size: archive.length, digest: `sha256:${incorrectDigest ? '0'.repeat(64) : digest}` })
      const releases = [
        { tag_name: 'newapi-v0.1.2', draft: false, prerelease: false, assets: incomplete ? [] : [asset('deepimage-newapi-0.1.2.tgz')] },
        { tag_name: 'v9.0.0', draft: false, prerelease: false, assets: [asset('deepimage-open-source-9.0.0.tgz')] },
      ]
      return new Response(JSON.stringify(releases), { status: 200 })
    }
    if (target.includes('/releases?page=')) {
      const section = tag => `<section id="release-${tag}"><a href="/chinahu-woker/deepimage/releases/tag/${tag}">${tag}</a></section>`
      return new Response(target.endsWith('page=1') ? `${section('newapi-v0.1.2')}${section('v9.0.0')}<a rel="next" href="?page=2">Next</a>` : section('newapi-v0.1.3'), { status: 200 })
    }
    if (target.includes('/expanded_assets/')) {
      const tag = target.split('/').at(-1)
      const version = tag.replace('newapi-v', '').replace(/^v/, '')
      const name = `deepimage-${tag.startsWith('newapi-') ? 'newapi' : 'open-source'}-${version}.tgz`
      return new Response(`<li><a href="/chinahu-woker/deepimage/releases/download/${tag}/${name}">${name}</a><span>sha256:${digest}</span></li>`, { status: 200 })
    }
    if (target.includes('/releases/download/')) return new Response(null, { status: 302, headers: { location: badRedirect ? 'https://evil.example/steal' : 'https://release-assets.githubusercontent.com/file' } })
    return new Response(archive, { status: 200 })
  },
}
vm.runInNewContext(source, context)

;(async () => {
  const ctx = { credentials, pluginManager, invocation: { peer: { principal: { kind: 'owner' } } } }
  const updater = new context.DeepImageUpdater(ctx)
  assert.equal((await updater.request({ action: 'check' })).latest, '0.1.2')
  const prepared = await updater.request({ action: 'prepare', version: '0.1.2' })
  assert.deepEqual(fs.readFileSync(prepared.path), archive)
  assert.ok(requests.every(request => !('Authorization' in request.headers)))
  await assert.rejects(() => updater.request({ action: 'prepare', version: '0.1.3' }), /重新检查/)
  incorrectDigest = true
  await assert.rejects(() => updater.request({ action: 'prepare', version: '0.1.2' }), /校验失败/)
  incorrectDigest = false
  badRedirect = true
  await assert.rejects(() => updater.request({ action: 'prepare', version: '0.1.2' }), /不受信任/)
  badRedirect = false
  incomplete = true
  await assert.rejects(() => updater.request({ action: 'check' }), /安装包缺失或无法校验/)
  incomplete = false
  edition = 'open-source'
  assert.equal((await updater.request({ action: 'check' })).latest, '9.0.0')
  edition = 'newapi'
  rateLimited = true
  assert.equal((await updater.request({ action: 'check' })).latest, '0.1.3')
  assert.deepEqual(fs.readFileSync((await updater.request({ action: 'prepare', version: '0.1.3' })).path), archive)
  linked = true
  await assert.rejects(() => updater.request({ action: 'check' }), /本地开发链接/)
  ctx.invocation.peer.principal.kind = 'guest'
  await assert.rejects(() => updater.request({ action: 'status' }), /本机用户/)
  console.log('Updater checks passed: anonymous API, public-page fallback, version, integrity and access.')
})().catch(error => { console.error(error); process.exitCode = 1 })
  .finally(() => fs.rmSync(temporary, { recursive: true, force: true }))
