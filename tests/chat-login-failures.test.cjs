const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../client.js'), 'utf8')
const start = source.indexOf('    const chatRoutes = [')
const end = source.indexOf('    function newApiAccount(', start)
assert.ok(start >= 0 && end > start)
const responses = {
  '/api/pricing': { data: [{ model_name: 'chat', supported_endpoint_types: ['openai'] }, { model_name: 'image', supported_endpoint_types: ['image-generation'] }] },
  '/api/token/search?keyword=deepImage&page_size=100': { data: { items: [{ id: 1, name: 'deepImage', status: 1 }], total: 1 } },
  '/api/token/1/key': { data: { key: 'sk-test' } },
  '/v1/models': { data: [{ id: 'chat' }, { id: 'image' }] },
  '/api/status': { data: {} },
}
let accountId = 43, failMedia = true
const scope = {
  newApiBase: 'https://token.aikna.cn', Set, Number, String, Error, Array, Object, Promise,
  newApiSession: null,
  newApiRequest: async route => route === '/api/user/self' ? { data: { id: accountId } } : responses[route],
  defaults: () => ({}), newApiAccount: user => ({ id: user.id }),
}
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.configureNewApi = configureNewApi; globalThis.syncExistingChat = syncExistingChat', scope)
let modelRevision = 1
const providers = { 'deepimage-newapi-42-chat': { api: 'openai-completions', baseURL: 'https://token.aikna.cn/v1', apiKeyEnv: 'DEEPIMAGE_NEWAPI_42', models: [{ id: 'old-chat' }] }, untouched: { apiKeyEnv: 'CUSTOM' } }
const modelForm = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision: modelRevision, value: { providers } }),
  async mutate(ops, rev) {
    if (rev !== modelRevision) return false
    for (const op of ops) op.op === 'unset' ? delete providers[op.path[1]] : providers[op.path[1]] = op.value
    modelRevision++; return true
  },
}
const originalImage = { id: 'newapi:42:image:image', model: 'image', endpoint: 'https://custom.example/image', apiKeyEnv: 'DEEPIMAGE_NEWAPI_42', requestBody: { custom: true } }
let account = { id: 42, chatSyncVersion: 1, chatRoutesManaged: true }
let mediaRevision = 1
const form = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision: mediaRevision, value: { newApiAccount: account, imageProviders: [originalImage], videoProviders: [], defaultImageProvider: originalImage.id } }),
  async mutate(ops, rev) {
    if (rev !== mediaRevision || failMedia) return false
    for (const op of ops) if (op.path[0] === 'newApiAccount') account = op.value
    mediaRevision++; return true
  },
}
const credentials = { async set() { return { ok: true } } }
;(async () => {
  await assert.rejects(() => scope.configureNewApi({ access_token: 'a', access_expires_at: 9999999999, user: { id: 43 } }, form, credentials, modelForm), /配置未保存/)
  assert.equal(account.id, 42)
  assert.ok(providers['deepimage-newapi-42-chat'])
  assert.equal(providers['deepimage-newapi-43-chat'], undefined)
  assert.equal(providers.untouched.apiKeyEnv, 'CUSTOM')
  failMedia = false; accountId = 42
  await scope.syncExistingChat({ access_token: 'a', user: { id: 42 } }, form, credentials, modelForm)
  assert.equal(originalImage.endpoint, 'https://custom.example/image')
  assert.equal(originalImage.requestBody.custom, true)
  assert.equal(account.chatRoutesManaged, true)
  assert.equal(account.chatSyncVersion, 1)
  account = null
  let savedCredential = false
  const readOnlyModels = { getSnapshot: () => ({ status: 'loading', writable: false, value: { providers } }) }
  await assert.rejects(() => scope.configureNewApi({ access_token: 'a', user: { id: 42 } }, form, { async set() { savedCredential = true; return { ok: true } } }, readOnlyModels), /对话模型配置暂不可写/)
  assert.equal(savedCredential, false)
  console.log('Chat login failure checks passed: account switch rollback and media configuration preservation.')
})().catch(error => { console.error(error); process.exitCode = 1 })
