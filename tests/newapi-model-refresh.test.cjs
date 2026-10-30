const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require('node:path').join(__dirname, '../client.js'), 'utf8')
const start = source.indexOf('    const chatRoutes = [')
const end = source.indexOf('    function newApiAccount(', start)
const catalog = [
  { model_name: 'image-kept', supported_endpoint_types: ['image-generation'] },
  { model_name: 'image-new', supported_endpoint_types: ['image-generation'] },
  { model_name: 'video-new', supported_endpoint_types: ['openai-video'] },
  { model_name: 'chat-kept', supported_endpoint_types: ['openai'] },
  { model_name: 'chat-new', supported_endpoint_types: ['openai'] },
]
let failCatalog = false, statusRequests = 0
const scope = {
  newApiBase: 'https://token.aikna.cn', Set, Number, String, Error, Array, Object, Promise, newApiSession: null,
  defaults: () => ({}), newApiAccount: user => ({ id: user.id, username: user.username }),
  async newApiRequest(route) {
    if (route === '/api/pricing') { if (failCatalog) throw Error('catalog unavailable'); return { data: catalog } }
    if (route === '/api/token/search?keyword=deepImage&page_size=100') return { data: { items: [{ id: 1, name: 'deepImage', status: 1 }], total: 1 } }
    if (route === '/api/token/1/key') return { data: { key: 'sk-test' } }
    if (route === '/v1/models') return { data: catalog.map(item => ({ id: item.model_name })) }
    if (route === '/api/user/self') return { data: { id: 42, username: 'test' } }
    if (route === '/api/status') { statusRequests++; return { data: {} } }
    throw Error('Unexpected request')
  },
}
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.configureNewApi = configureNewApi', scope)
function createForm(value) {
  let revision = 1
  return {
    getSnapshot: () => ({ status: 'ready', writable: true, revision, value }),
    async mutate(ops, expected) {
      if (expected !== revision) return false
      for (const { op, path, value: next } of ops) {
        let target = value
        for (const part of path.slice(0, -1)) target = target[part]
        if (op === 'set') target[path.at(-1)] = next
        else if (op === 'unset') delete target[path.at(-1)]
      }
      revision++
      return true
    },
  }
}
const state = {
  newApiAccount: { id: 42, chatSyncVersion: 1, chatRoutesManaged: true },
  imageProviders: [
    { id: 'manual', model: 'manual', apiKeyEnv: 'CUSTOM' },
    { id: 'newapi:42:image:image-kept', model: 'image-kept', endpoint: 'https://custom.example', timeoutMs: 12345 },
    { id: 'newapi:42:image:removed', model: 'removed' },
  ],
  videoProviders: [], defaultImageProvider: 'newapi:42:image:image-kept',
}
const models = { providers: {
  'deepimage-newapi-42-chat': { baseURL: 'https://token.aikna.cn/v1', apiKeyEnv: 'DEEPIMAGE_NEWAPI_42', defaultContextWindow: 9999, models: [{ id: 'chat-kept', maxTokens: 777 }, { id: 'removed' }] },
  manual: { apiKeyEnv: 'CUSTOM' },
} }
const form = createForm(state), modelForm = createForm(models)
const credentials = { async set() { return { ok: true } } }
const bundle = { access_token: 'session', access_expires_at: 9999999999, user: { id: 42 } }
;(async () => {
  const result = await scope.configureNewApi(bundle, form, credentials, modelForm, 42)
  assert.deepEqual([result.images, result.videos, result.chats, result.chatError], [2, 1, 2, ''])
  assert.deepEqual(Array.from(state.imageProviders, x => x.id), ['manual', 'newapi:42:image:image-kept', 'newapi:42:image:image-new'])
  assert.equal(state.imageProviders[1].endpoint, 'https://custom.example')
  assert.equal(state.imageProviders[1].timeoutMs, 12345)
  assert.equal(state.defaultImageProvider, 'newapi:42:image:image-kept')
  assert.equal(state.videoProviders[0].model, 'video-new')
  assert.equal(models.providers['deepimage-newapi-42-chat'].defaultContextWindow, 9999)
  assert.equal(models.providers['deepimage-newapi-42-chat'].models[0].maxTokens, 777)
  assert.deepEqual(Array.from(models.providers['deepimage-newapi-42-chat'].models, x => x.id), ['chat-kept', 'chat-new'])
  assert.equal(models.providers.manual.apiKeyEnv, 'CUSTOM')
  const before = JSON.stringify({ state, models })
  failCatalog = true
  await assert.rejects(() => scope.configureNewApi(bundle, form, credentials, modelForm, 42), /catalog unavailable/)
  assert.equal(JSON.stringify({ state, models }), before)
  failCatalog = false
  await assert.rejects(() => scope.configureNewApi(bundle, form, credentials, modelForm, 43), /当前账户已更换/)
  assert.equal(JSON.stringify({ state, models }), before)
  catalog.length = 0
  statusRequests = 0
  const empty = await scope.configureNewApi(bundle, form, credentials, modelForm, 42, { user: { id: 42, username: 'test' }, status: { quota_display_type: 'CNY' } })
  assert.deepEqual([empty.images, empty.videos, empty.chats], [0, 0, 0])
  assert.deepEqual(Array.from(state.imageProviders, x => x.id), ['manual'])
  assert.equal(state.videoProviders.length, 0)
  assert.equal(state.defaultImageProvider, '')
  assert.equal(models.providers['deepimage-newapi-42-chat'], undefined)
  assert.equal(models.providers.manual.apiKeyEnv, 'CUSTOM')
  assert.equal(statusRequests, 0)
  console.log('Model refresh checks passed: all model types, preservation, removals and failure safety.')
})().catch(error => { console.error(error); process.exitCode = 1 })
