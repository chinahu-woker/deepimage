const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { latest, download } = require('../installer/download-latest.cjs')
const bytes = Buffer.from('verified plugin package')
const digest = createHash('sha256').update(bytes).digest('hex')
const release = (tag, edition, version, value = digest) => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: `deepimage-${edition}-${version}.tgz`, size: bytes.length, digest: `sha256:${value}` }] })
const releases = [release('newapi-v0.1.9', 'newapi', '0.1.9'), release('v0.1.7', 'open-source', '0.1.7'), release('v0.1.10', 'open-source', '0.1.10'), { tag_name: 'v0.9.0', prerelease: true }]
function fetcher(data = releases, content = bytes) {
  return async url => {
    const target = String(url)
    if (target.startsWith('https://api.github.com/')) return new Response(JSON.stringify(data), { status: 200 })
    if (target.startsWith('https://github.com/')) return new Response(content, { status: 200 })
    throw new Error('Unexpected destination')
  }
}
;(async () => {
  assert.equal((await latest('open-source', fetcher())).version, '0.1.10')
  assert.equal((await latest('newapi', fetcher())).version, '0.1.9')
  const dir = await mkdtemp(path.join(tmpdir(), 'deepimage-installer-test-'))
  try {
    const file = path.join(dir, 'plugin.tgz')
    assert.equal(await download('newapi', file, fetcher()), '0.1.9')
    assert.deepEqual(await readFile(file), bytes)
    await assert.rejects(download('newapi', path.join(dir, 'bad.tgz'), fetcher(releases, Buffer.from('incorrect payload'))), /校验失败/)
    await assert.rejects(latest('newapi', fetcher([release('newapi-v0.2.0', 'newapi', '0.2.0', 'bad')])), /无法校验/)
    const redirect = async url => String(url).startsWith('https://api.github.com/') ? new Response(JSON.stringify(releases)) : new Response(null, { status: 302, headers: { location: 'https://evil.example/package' } })
    await assert.rejects(download('newapi', path.join(dir, 'redirect.tgz'), redirect), /不受信任/)
    const fallback = async url => {
      const target = String(url)
      if (target.startsWith('https://api.github.com/')) return new Response('', { status: 403 })
      if (target.includes('/expanded_assets/')) return new Response(`<li><a href="/chinahu-woker/deepimage/releases/download/newapi-v0.1.9/deepimage-newapi-0.1.9.tgz">x</a><span>sha256:${digest}</span></li>`)
      return new Response('<section id="release-newapi-v0.1.9"><a href="/chinahu-woker/deepimage/releases/tag/newapi-v0.1.9">x</a></section>')
    }
    assert.equal((await latest('newapi', fallback)).version, '0.1.9')
    console.log('Installer download checks passed: editions, latest version, integrity, redirect and rate-limit fallback.')
  } finally { await rm(dir, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
