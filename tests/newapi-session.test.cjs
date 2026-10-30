const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
const start = source.indexOf('class NewApiService extends Service')
const end = source.indexOf('\nfunction commonProviderFields()', start)
assert.ok(start >= 0 && end > start)
const code = source.slice(start, end) + '\nglobalThis.NewApiService = NewApiService'
const stored = new Map()
let revoked = false
let expectedCookie = 'refresh-1'
let refreshCount = 0
let logoutFailure = false
let logoutCount = 0
class Service { constructor(ctx, name) { this.ctx = ctx; this.name = name } }
const context = {
  Service, credentialRef: name => name, Buffer, AbortSignal, Number, Object, Array, String, JSON, Error, Map, Promise,
  fetch: async (url, options) => {
    const route = new URL(url).pathname
    if (route === '/api/user/login') return new Response(JSON.stringify({ success: true, data: { user: { id: 42 }, access_token: 'access-1' } }), { headers: { 'set-cookie': 'new_api_refresh=refresh-1; HttpOnly; Secure' } })
    if (route === '/api/user/auth/logout') {
      logoutCount++
      assert.equal(options.body, '{}')
      assert.equal(options.headers.Cookie, `new_api_refresh=${expectedCookie}`)
      if (logoutFailure) throw new Error('Network unavailable')
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    if (route === '/api/user/auth/refresh') {
      if (revoked || options.headers.Cookie !== `new_api_refresh=${expectedCookie}`) return new Response('', { status: 401 })
      expectedCookie = `refresh-${++refreshCount + 1}`
      return new Response(JSON.stringify({ success: true, data: { user: { id: 42 }, access_token: `access-${refreshCount + 1}` } }), { headers: { 'set-cookie': `new_api_refresh=${expectedCookie}; HttpOnly; Secure` } })
    }
    throw new Error(`Unexpected route ${route}`)
  },
}
vm.runInNewContext(code, context)
const filterStart = source.indexOf('  const availableProviders = (providers, kind) => {')
const filterEnd = source.indexOf('  const imageProviders = ', filterStart)
assert.ok(filterStart >= 0 && filterEnd > filterStart)
const filterContext = { config: { newApiAccount: { get: () => filterContext.account } }, indexProviders: providers => providers, account: { id: 42 } }
vm.runInNewContext(source.slice(filterStart, filterEnd) + '\nglobalThis.availableProviders = availableProviders', filterContext)
const providers = [
  { id: 'newapi:42:image:a', apiKeyEnv: 'DEEPIMAGE_NEWAPI_42' },
  { id: 'renamed', apiKeyEnv: 'DEEPIMAGE_NEWAPI_42' },
  { id: 'newapi:43:image:b', apiKeyEnv: 'DEEPIMAGE_NEWAPI_43' },
  { id: 'manual', apiKeyEnv: 'CUSTOM_KEY' },
]
assert.deepEqual(Array.from(filterContext.availableProviders(providers, 'image'), p => p.id), ['newapi:42:image:a', 'renamed', 'manual'])
filterContext.account = null
assert.deepEqual(Array.from(filterContext.availableProviders(providers, 'image'), p => p.id), ['manual'])
filterContext.account = { id: 43 }
assert.deepEqual(Array.from(filterContext.availableProviders(providers, 'image'), p => p.id), ['newapi:43:image:b', 'manual'])
const ctx = { invocation: { peer: { principal: { kind: 'owner' } } }, credentials: {
  async set(ref, value) { stored.set(ref, value) },
  async resolve(ref) { return stored.has(ref) ? { value: stored.get(ref) } : null },
  async unset(ref) { stored.delete(ref) },
} }
const request = (path, body) => ({ path, token: '', body })
;(async () => {
  const first = new context.NewApiService(ctx)
  await first.request(request('/api/user/login', { username: 'test', password: 'test' }))
  assert.equal(stored.get('DEEPIMAGE_NEWAPI_SESSION_42'), 'refresh-1')
  const restarted = new context.NewApiService(ctx)
  const result = await restarted.request(request('/api/user/auth/refresh', { userId: 42 }))
  assert.equal(result.data.access_token, 'access-2')
  assert.equal(stored.get('DEEPIMAGE_NEWAPI_SESSION_42'), 'refresh-2')
  const concurrent = await Promise.all([restarted.request(request('/api/user/auth/refresh', { userId: 42 })), restarted.request(request('/api/user/auth/refresh', { userId: 42 }))])
  assert.equal(concurrent.length, 2)
  assert.equal(stored.get('DEEPIMAGE_NEWAPI_SESSION_42'), 'refresh-4')
  stored.set('DEEPIMAGE_NEWAPI_42', 'api-key')
  logoutFailure = true
  await assert.rejects(() => restarted.request(request('/api/user/auth/logout', { userId: 42 })), /Network unavailable/)
  assert.equal(stored.get('DEEPIMAGE_NEWAPI_SESSION_42'), 'refresh-4')
  assert.equal(stored.get('DEEPIMAGE_NEWAPI_42'), 'api-key')
  logoutFailure = false
  await restarted.request(request('/api/user/auth/logout', { userId: 42 }))
  assert.equal(stored.has('DEEPIMAGE_NEWAPI_SESSION_42'), false)
  assert.equal(stored.has('DEEPIMAGE_NEWAPI_42'), false)
  assert.equal(logoutCount, 2)
  await restarted.request(request('/api/user/auth/logout', { userId: 42 }))
  assert.equal(logoutCount, 2)
  await assert.rejects(() => restarted.request(request('/api/user/auth/refresh', { userId: 42 })), /未找到可恢复/)
  stored.set('DEEPIMAGE_NEWAPI_SESSION_42', expectedCookie)
  revoked = true
  await assert.rejects(() => restarted.request(request('/api/user/auth/refresh', { userId: 42 })), /登录会话已失效/)
  await assert.rejects(() => restarted.request(request('/api/user/auth/refresh', { userId: 99 })), /未找到可恢复/)
  console.log('New API session checks passed: saved, restored after restart, rotated safely, logged out and handled expiry.')
})().catch(error => { console.error(error); process.exitCode = 1 })
