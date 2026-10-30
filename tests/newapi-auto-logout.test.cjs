const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require('node:path').join(__dirname, '../client.js'), 'utf8')
const start = source.indexOf('    function isExpiredNewApiSession(')
const end = source.indexOf('    let updateRemote', start)
assert.ok(start >= 0 && end > start)
function makeHarness(mode, initialAccount = { id: 42, username: 'tester', chatSyncVersion: 1, chatRoutesManaged: true }) {
  let cursor = 0, effects = [], timers = [], state = [], calls = [], removeCount = 0, account = initialAccount, revision = 1, selfCalls = 0
  const React = {
    Fragment: Symbol('fragment'), createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial } },
    useEffect(fn) { effects.push(fn) },
  }
  const form = {
    getSnapshot: () => ({ status: 'ready', writable: true, revision, value: { newApiAccount: account } }),
    async mutate(ops, expected) { if (expected !== revision) return false; account = ops[0].value; revision++; return true },
  }
  const modelForm = {}
  const scope = {
    React, h: React.createElement, form, modelForm, Date, Number, Array, Error, Promise, setInterval: fn => { timers.push(fn); return timers.length }, clearInterval: () => {},
    newApiSession: mode === 'access-expired' ? { id: 42, token: 'old', expiresAt: Date.now() + 600000 } : null,
    newApiNotice: '', withNewApiLock: async fn => fn(), newApiAccount: user => ({ id: user.id, username: user.username }), formatNewApiBalance: () => 'balance',
    async writeChatRoutes() { removeCount++ },
    async configureNewApi() { throw new Error('配置失败') },
    async newApiRequest(path) {
      calls.push(path)
      if (path === '/api/user/auth/forget') return { success: true }
      if (path === '/api/user/login') {
        if (mode === 'configuration-failure') return { data: { user: { id: 42 }, access_token: 'session' } }
        throw new Error('用户名或密码错误')
      }
      if (mode === 'expired' || mode === 'revoked') throw new Error('登录会话已失效，请重新登录。')
      if (mode === 'offline') throw new Error('网络不可用')
      if (path === '/api/user/auth/refresh') return { data: { user: { id: 42 }, access_token: 'renewed', access_expires_at: Date.now() / 1000 + 600 } }
      if (path === '/api/user/self') { if (mode === 'access-expired' && !selfCalls++) throw new Error('登录会话已失效，请重新登录。'); return { data: { id: 42, username: 'tester' } } }
      if (path === '/api/status') return { data: {} }
      throw new Error('Unexpected request')
    },
    syncExistingChat: async () => 0,
  }
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.Login = NewApiLogin', scope)
  function render(background = false) { cursor = 0; effects = []; return scope.Login({ form, credentials: {}, modelForm, modelReady: true, account, onBusyChange() {}, background }) }
  return { scope, render, get effects() { return effects }, get calls() { return calls }, get timers() { return timers }, get account() { return account }, get revision() { return revision }, get removeCount() { return removeCount }, setMode(value) { mode = value } }
}
async function settle() { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)) }
function hasButton(tree, label) { if (!tree || typeof tree !== 'object') return false; return tree.type === 'button' && tree.props['aria-label'] === label || (tree.children || []).some(child => hasButton(child, label)) }
;(async () => {
  const expired = makeHarness('expired')
  const before = expired.render()
  assert.equal(hasButton(before, '重新登录'), false)
  expired.effects[0](); await settle()
  assert.equal(expired.account, null)
  assert.ok(expired.calls.includes('/api/user/auth/forget'))
  assert.equal(expired.removeCount, 1)
  const after = expired.render()
  assert.equal(after.type, 'form')
  assert.match(expired.scope.newApiNotice, /登录已失效/)

  const offline = makeHarness('offline')
  offline.render(true); offline.effects[0](); offline.effects[1](); await settle()
  assert.equal(offline.account.id, 42)
  assert.equal(offline.calls.includes('/api/user/auth/forget'), false)
  offline.setMode('valid'); offline.timers[0](); await settle()
  assert.equal(offline.account.id, 42)
  assert.ok(offline.calls.includes('/api/user/self'))
  assert.equal(offline.revision, 1, 'background validation must not modify settings')
  offline.setMode('revoked'); offline.timers[0](); await settle()
  assert.equal(offline.account, null, 'background validation detects revoked accounts with an unexpired access token')

  const stale = makeHarness('access-expired')
  stale.render(); stale.effects[0](); await settle()
  assert.equal(stale.account.id, 42)
  assert.equal(stale.calls.filter(path => path === '/api/user/self').length, 2)
  assert.ok(stale.calls.includes('/api/user/auth/refresh'))
  assert.equal(stale.calls.includes('/api/user/auth/forget'), false)

  const login = makeHarness('login-failure', null)
  const loginView = login.render()
  await loginView.props.onSubmit({ preventDefault() {} })
  assert.equal(login.account, null)
  const failedConfiguration = makeHarness('configuration-failure', null)
  await failedConfiguration.render().props.onSubmit({ preventDefault() {} })
  assert.equal(failedConfiguration.account, null)
  assert.ok(failedConfiguration.calls.includes('/api/user/auth/forget'))
  console.log('Automatic logout checks passed: expired, offline recovery, access renewal and failed login.')
})().catch(error => { console.error(error); process.exitCode = 1 })
