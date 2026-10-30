const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../client.js'), 'utf8')
const start = source.indexOf('    const chatRoutes = [')
const end = source.indexOf('    async function configureNewApi', start)
assert.ok(start >= 0 && end > start)
const scope = { newApiBase: 'https://token.aikna.cn', Set, Number, String, Error, Array, Object }
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.writeChatRoutes = writeChatRoutes', scope)
const providerConfig = { userexisting: { baseURL: 'https://example.com/v1', apiKeyEnv: 'USER_KEY' } }
let revision = 1
const form = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision, value: { providers: providerConfig } }),
  async mutate(ops, expected) {
    if (expected !== revision) return false
    for (const op of ops) {
      if (op.op === 'set') providerConfig[op.path[1]] = op.value
      else if (op.op === 'unset') delete providerConfig[op.path[1]]
      else throw Error('Unexpected mutation')
    }
    revision++
    return true
  },
}
const items = [
  { model_name: 'chat-a', supported_endpoint_types: ['openai'] },
  { model_name: 'chat-a', supported_endpoint_types: ['openai'] },
  { model_name: 'chat-b', supported_endpoint_types: ['openai', 'openai-response'] },
  { model_name: 'responses-only', supported_endpoint_types: ['openai-response'] },
  { model_name: 'image', supported_endpoint_types: ['image-generation'] },
  { model_name: 'video', supported_endpoint_types: ['openai-video'] },
]
;(async () => {
  assert.equal(await scope.writeChatRoutes(form, 42, items), 3)
  const chat = providerConfig['deepimage-newapi-42-chat']
  const responses = providerConfig['deepimage-newapi-42-responses']
  assert.equal(chat.api, 'openai-completions')
  assert.equal(chat.baseURL, 'https://token.aikna.cn/v1')
  assert.equal(chat.apiKeyEnv, 'DEEPIMAGE_NEWAPI_42')
  assert.deepEqual(Array.from(chat.models, item => item.id), ['chat-a', 'chat-b'])
  assert.equal(responses.api, 'openai-responses')
  assert.deepEqual(Array.from(responses.models, item => item.id), ['responses-only'])
  assert.equal(providerConfig.userexisting.apiKeyEnv, 'USER_KEY')
  await scope.writeChatRoutes(form, 43, items)
  assert.equal(providerConfig['deepimage-newapi-43-chat'].apiKeyEnv, 'DEEPIMAGE_NEWAPI_43')
  await scope.writeChatRoutes(form, 42, [], true)
  assert.ok(providerConfig['deepimage-newapi-43-chat'])
  assert.equal(providerConfig['deepimage-newapi-42-chat'], undefined)
  await scope.writeChatRoutes(form, 43, [], true)
  assert.equal(providerConfig['deepimage-newapi-43-chat'], undefined)
  assert.equal(providerConfig['deepimage-newapi-43-responses'], undefined)
  assert.equal(providerConfig.userexisting.apiKeyEnv, 'USER_KEY')
  providerConfig['deepimage-newapi-42-chat'] = { baseURL: 'https://elsewhere.example/v1', apiKeyEnv: 'USER_KEY' }
  await assert.rejects(() => scope.writeChatRoutes(form, 42, items), /已被占用/)
  delete providerConfig['deepimage-newapi-42-chat']
  let account = { id: 42, chatSyncVersion: 0, chatRoutesManaged: false }
  let accountRevision = 1, failFinal = true
  const accountForm = {
    getSnapshot: () => ({ revision: accountRevision, value: { newApiAccount: account } }),
    async mutate(ops, expected) {
      if (expected !== accountRevision || (failFinal && ops[0].value.chatSyncVersion === 1)) return false
      account = ops[0].value; accountRevision++; return true
    },
  }
  const credentials = { async set() { return { ok: true } } }
  const syncStart = source.indexOf('    async function syncExistingChat(')
  const syncEnd = source.indexOf('    function newApiAccount(', syncStart)
  assert.ok(syncStart >= 0 && syncEnd > syncStart)
  vm.runInNewContext(source.slice(syncStart, syncEnd) + '\nglobalThis.syncExistingChat = syncExistingChat', scope)
  await assert.rejects(() => scope.syncExistingChat({}, accountForm, credentials, form, { userId: 42, key: 'test', eligible: items }), /同步状态未保存/)
  assert.equal(account.chatRoutesManaged, true)
  assert.equal(account.chatSyncVersion, 0)
  assert.ok(providerConfig['deepimage-newapi-42-chat'])
  failFinal = false
  assert.equal(await scope.syncExistingChat({}, accountForm, credentials, form, { userId: 42, key: 'test', eligible: items }), 3)
  assert.equal(account.chatSyncVersion, 1)
  console.log('Chat model sync checks passed: protocols, deduplication, account switching, logout and conflicts.')
})().catch(error => { console.error(error); process.exitCode = 1 })
