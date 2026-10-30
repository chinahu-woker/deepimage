window.__ModuleLoader__.load({
  id: 'dsh-media-generation',
  factory(require) {
    const React = require('react')
    const { Menu, MenuItemButton } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const fields = [
      ['id', '服务商 ID', true], ['endpoint', '创建任务 API 地址', true],
      ['model', '模型 ID', true], ['apiKeyEnv', '凭据引用名称', true],
      ['authHeader', '认证请求头'], ['authPrefix', '认证前缀'],
    ]
    const imageFields = [['imageUrlPath', '图片 URL 字段路径'], ['imageBase64Path', '图片 Base64 字段路径'], ['imageMimeType', '图片 MIME 类型']]
    const videoFields = [['statusEndpointTemplate', '查询任务地址（包含 {taskId}）', true], ['taskIdPath', '任务 ID 字段路径'], ['statusPath', '任务状态字段路径'], ['videoUrlPath', '视频 URL 字段路径'], ['errorPath', '错误信息字段路径']]
    const defaults = (kind) => kind === 'image'
      ? { id: '', endpoint: '', model: '', apiKeyEnv: '', authHeader: 'Authorization', authPrefix: 'Bearer ', imageUrlPath: 'data.0.url', imageBase64Path: 'data.0.b64_json', imageMimeType: 'image/png' }
      : { id: '', endpoint: '', model: '', apiKeyEnv: '', authHeader: 'Authorization', authPrefix: 'Bearer ', statusEndpointTemplate: '', taskIdPath: 'id', statusPath: 'status', videoUrlPath: 'content.video_url', errorPath: 'error.message' }

    const newApiBase = 'https://token.aikna.cn'
    let newApiRemote
    let newApiSession
    let newApiNotice = ''
    const newApiCodec = { mode: 'strict', typeSymbol: 'deepimage#newapi-request', create: () => ({ parse: value => value }) }
    const newApiDescriptor = { id: 'deepimage/newapi-request', service: 'deepImageNewApi', namespace: 'deepImageNewApi', method: 'request', invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: newApiCodec }], result: { mode: 'strict', typeSymbol: 'deepimage#newapi-response', create: () => ({ parse: value => value }) } }
    async function newApiRequest(path, { token, body } = {}) {
      if (!newApiRemote?.deepImageNewApi) throw new Error('New API 连接服务尚未就绪，请稍后重试。')
      const response = await newApiRemote.deepImageNewApi.request({ path, token: token || '', body: body ?? null })
      if (!response.ok) throw new Error(response.error?.message || 'New API 请求失败。')
      const data = response.value
      if (data?.success === false) throw new Error(data.message || 'New API 请求失败。')
      return data
    }

    const withNewApiLock = action => navigator.locks ? navigator.locks.request('deepimage-newapi-account', action) : action()

    const chatRoutes = [
      { id: 'chat', endpoint: 'openai', api: 'openai-completions', displayName: 'AIKNA' },
      { id: 'responses', endpoint: 'openai-response', api: 'openai-responses', displayName: 'AIKNA · Responses' },
    ]
    const chatRouteId = (userId, kind) => `deepimage-newapi-${userId}-${kind}`
    function managedChatRoute(profile) {
      return profile && profile.baseURL === `${newApiBase}/v1` && /^DEEPIMAGE_NEWAPI_[1-9]\d*$/.test(profile.apiKeyEnv || '')
    }
    async function writeChatRoutes(modelForm, userId, eligible, remove = false) {
      const snapshot = modelForm.getSnapshot()
      if (snapshot.status !== 'ready' || !snapshot.writable) throw new Error('对话模型配置暂不可写，请稍后重试。')
      const providers = snapshot.value?.providers || {}
      const ops = []
      let count = 0
      for (const route of chatRoutes) {
        const id = chatRouteId(userId, route.id)
        const existing = providers[id]
        if (remove && existing && !managedChatRoute(existing)) continue
        if (existing && !managedChatRoute(existing)) throw new Error(`对话模型服务商 ${id} 已被占用，请先更换其名称。`)
        if (remove && existing?.apiKeyEnv !== `DEEPIMAGE_NEWAPI_${userId}`) continue
        const list = remove ? [] : eligible.filter(item => item.supported_endpoint_types.includes(route.endpoint) && (route.endpoint !== 'openai-response' || !item.supported_endpoint_types.includes('openai')))
        if (list.length) {
          const seen = new Set()
          const models = list.filter(item => !seen.has(item.model_name) && seen.add(item.model_name)).map(item => existing?.models?.find(model => model.id === item.model_name) || { id: item.model_name })
          count += models.length
          ops.push({ op: 'set', path: ['providers', id], value: { displayName: route.displayName, defaultContextWindow: 32768, defaultMaxTokens: 4096, timeoutMs: 300000, streamIdleTimeoutMs: 300000, ...existing, apiKeyEnv: `DEEPIMAGE_NEWAPI_${userId}`, baseURL: `${newApiBase}/v1`, api: route.api, models } })
        } else if (existing) ops.push({ op: 'unset', path: ['providers', id] })
      }
      if (ops.length && !await modelForm.mutate(ops, snapshot.revision)) throw new Error('对话模型配置未保存，可能已被其他页面修改，请重试。')
      return count
    }

    async function loadNewApiCatalog(bundle) {
      const token = bundle?.access_token
      const userId = bundle?.user?.id
      if (typeof token !== 'string' || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录响应不完整，请检查 New API 版本。')
      const pricing = await newApiRequest('/api/pricing', { token })
      if (!Array.isArray(pricing.data)) throw new Error('无法读取模型能力列表。')
      const name = 'deepImage'
      const search = await newApiRequest('/api/token/search?keyword=deepImage&page_size=100', { token })
      if (!Array.isArray(search.data?.items) || (Number.isFinite(search.data.total) && search.data.total > search.data.items.length)) throw new Error('无法完整读取 deepImage 密钥列表，请先整理 New API 中的同名密钥。')
      const matches = (search.data?.items || []).filter(item => item.name === name)
      if (matches.length > 1) throw new Error('存在多个 deepImage API 密钥，请在 New API 中保留一个后重试。')
      if (!matches.length) {
        await newApiRequest('/api/token/', { token, body: { name, expired_time: -1, unlimited_quota: true, model_limits_enabled: false, group: '', allow_user_quota_query: false } })
        const created = await newApiRequest('/api/token/search?keyword=deepImage&page_size=100', { token })
        if (!Array.isArray(created.data?.items) || (Number.isFinite(created.data.total) && created.data.total > created.data.items.length)) throw new Error('无法完整读取新建的密钥，请检查 New API 后重试。')
        matches.push(...(created.data?.items || []).filter(item => item.name === name))
      }
      if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].status !== 1) throw new Error('deepImage API 密钥不可用，请在 New API 中检查后重试。')
      const keyResult = await newApiRequest(`/api/token/${matches[0].id}/key`, { token, body: {} })
      const rawKey = keyResult.data?.key
      if (typeof rawKey !== 'string' || !rawKey || rawKey.includes('*')) throw new Error('无法读取 deepImage API 密钥。')
      const key = rawKey.startsWith('sk-') ? rawKey : `sk-${rawKey}`
      const models = await newApiRequest('/v1/models', { token: key })
      if (!Array.isArray(models.data)) throw new Error('无法读取 API 密钥可用的模型。')
      const allowed = new Set(models.data.map(item => item.id).filter(id => typeof id === 'string'))
      const eligible = pricing.data.filter(item => allowed.has(item.model_name) && Array.isArray(item.supported_endpoint_types))
      return { userId, token, key, eligible }
    }

    async function configureNewApi(bundle, form, credentials, modelForm, expectedAccountId, accountInfo) {
      const { userId, token, key, eligible } = await loadNewApiCatalog(bundle)
      const ref = `DEEPIMAGE_NEWAPI_${userId}`
      const prefix = `newapi:${userId}:`
      const imageModels = eligible.filter(item => item.supported_endpoint_types.includes('image-generation'))
      const videoModels = eligible.filter(item => item.supported_endpoint_types.includes('openai-video'))
      const chatModels = eligible.filter(item => item.supported_endpoint_types.includes('openai') || item.supported_endpoint_types.includes('openai-response'))
      if (!imageModels.length && !videoModels.length && !chatModels.length && !expectedAccountId) throw new Error('该密钥没有可识别的兼容对话、图片或视频模型。请检查 New API 的模型和分组配置。')
      const snapshot = form.getSnapshot()
      if (snapshot.status !== 'ready' || !snapshot.writable) throw new Error('当前配置不可写，请稍后重试。')
      const current = snapshot.value || {}
      if (expectedAccountId && current.newApiAccount?.id !== expectedAccountId) throw new Error('当前账户已更换，请重新同步。')
      const imageProviders = (current.imageProviders || []).filter(item => !item.id.startsWith(prefix) && (item.apiKeyEnv !== ref || imageModels.some(model => model.model_name === item.model)))
      const videoProviders = (current.videoProviders || []).filter(item => !item.id.startsWith(prefix) && (item.apiKeyEnv !== ref || videoModels.some(model => model.model_name === item.model)))
      for (const item of imageModels) {
        const id = `${prefix}image:${item.model_name}`
        const previous = (current.imageProviders || []).find(provider => provider.id === id)
        imageProviders.push({ ...defaults('image'), endpoint: `${newApiBase}/v1/images/generations`, ...previous, id, model: item.model_name, apiKeyEnv: ref })
      }
      for (const item of videoModels) {
        const id = `${prefix}video:${item.model_name}`
        const previous = (current.videoProviders || []).find(provider => provider.id === id)
        videoProviders.push({ ...defaults('video'), endpoint: `${newApiBase}/v1/videos`, statusEndpointTemplate: `${newApiBase}/v1/videos/{taskId}`, protocol: 'newapi-video', taskIdPath: 'id', statusPath: 'status', successStatuses: ['completed'], failureStatuses: ['failed', 'cancelled', 'expired'], ...previous, id, model: item.model_name, apiKeyEnv: ref })
      }
      if (!expectedAccountId && current.newApiAccount?.id !== userId) await writeChatRoutes(modelForm, userId, [], true)
      const saved = await credentials.set(ref, key)
      if (!saved.ok) throw new Error(saved.error?.message || 'API 密钥保存失败。')
      const oldDefault = current.defaultImageProvider
      const oldDefaultProvider = imageProviders.find(item => item.id === oldDefault)
      const ownerId = oldDefaultProvider && /^newapi:(\d+):/.exec(oldDefaultProvider.id)?.[1]
      const credentialOwner = oldDefaultProvider && /^DEEPIMAGE_NEWAPI_(\d+)$/.exec(oldDefaultProvider.apiKeyEnv)?.[1]
      const defaultImage = oldDefaultProvider && (!ownerId || ownerId === String(userId)) && (!credentialOwner || credentialOwner === String(userId)) ? oldDefault : imageModels.length ? `${prefix}image:${imageModels[0].model_name}` : ''
      const [selfResult, statusResult] = accountInfo
        ? [{ status: 'fulfilled', value: { data: accountInfo.user } }, { status: 'fulfilled', value: { data: accountInfo.status } }]
        : await Promise.allSettled([newApiRequest('/api/user/self', { token }), newApiRequest('/api/status')])
      if (selfResult.status === 'rejected' && isExpiredNewApiSession(selfResult.reason)) throw selfResult.reason
      const self = selfResult.status === 'fulfilled' && selfResult.value.data?.id === userId ? selfResult.value.data : bundle.user
      const modelSnapshot = modelForm.getSnapshot()
      const oldAccount = current.newApiAccount
      const switching = oldAccount?.id && oldAccount.id !== userId
      if (switching && (oldAccount.chatRoutesManaged || oldAccount.chatSyncVersion === 1) && (modelSnapshot.status !== 'ready' || !modelSnapshot.writable)) throw new Error('切换账户前无法安全更新对话模型，请检查模型配置后重试。')
      const removedRoutes = []
      if (modelSnapshot.status === 'ready' && modelSnapshot.writable) {
        const providers = modelSnapshot.value?.providers || {}
        for (const [route, profile] of Object.entries(providers)) {
          if (/^deepimage-newapi-[1-9]\d*-(?:chat|responses)$/.test(route) && managedChatRoute(profile) && profile.apiKeyEnv !== ref) removedRoutes.push({ route, profile })
        }
        if (removedRoutes.length && !await modelForm.mutate(removedRoutes.map(item => ({ op: 'unset', path: ['providers', item.route] })), modelSnapshot.revision)) throw new Error('无法安全切换对话模型，请重试。')
      }
      const account = { ...newApiAccount(self, statusResult.status === 'fulfilled' ? statusResult.value.data : null), chatSyncVersion: 0, chatRoutesManaged: oldAccount?.id === userId && (!!oldAccount.chatRoutesManaged || oldAccount.chatSyncVersion === 1) }
      const ok = await form.mutate([{ op: 'set', path: ['imageProviders'], value: imageProviders }, { op: 'set', path: ['videoProviders'], value: videoProviders }, { op: 'set', path: ['defaultImageProvider'], value: defaultImage }, { op: 'set', path: ['newApiAccount'], value: account }], snapshot.revision)
      if (!ok) {
        const latest = form.getSnapshot()
        const routeSnapshot = modelForm.getSnapshot()
        if (removedRoutes.length && latest.value?.newApiAccount?.id === oldAccount?.id && routeSnapshot.status === 'ready' && routeSnapshot.writable) {
          const vacant = removedRoutes.filter(item => !routeSnapshot.value?.providers?.[item.route])
          if (vacant.length) await modelForm.mutate(vacant.map(item => ({ op: 'set', path: ['providers', item.route], value: item.profile })), routeSnapshot.revision)
        }
        throw new Error('配置未保存，可能已被其他页面修改。请重新登录以重试。')
      }
      newApiSession = { token, id: userId, expiresAt: bundle.access_expires_at * 1000 }
      let chats = 0, chatError = ''
      try {
        chats = await syncExistingChat({ access_token: token, access_expires_at: bundle.access_expires_at, user: self }, form, credentials, modelForm, { userId, key, eligible })
      } catch (error) { chatError = error.message || '对话模型同步失败，请稍后重试。' }
      return { chats, images: imageModels.length, videos: videoModels.length, chatError }
    }

    async function syncExistingChat(bundle, form, credentials, modelForm, catalog) {
      const { userId, key, eligible } = catalog || await loadNewApiCatalog(bundle)
      const before = form.getSnapshot()
      if (before.value?.newApiAccount?.id !== userId) throw new Error('当前账户已更换，请重新同步。')
      const modelState = modelForm.getSnapshot()
      if (modelState.status !== 'ready' || !modelState.writable) throw new Error('对话模型配置暂不可写，请稍后重试。')
      if (!before.value.newApiAccount.chatRoutesManaged) {
        if (!await form.mutate([{ op: 'set', path: ['newApiAccount'], value: { ...before.value.newApiAccount, chatRoutesManaged: true } }], before.revision)) throw new Error('对话模型同步状态未保存，请重试。')
      }
      const saved = await credentials.set(`DEEPIMAGE_NEWAPI_${userId}`, key)
      if (!saved.ok) throw new Error(saved.error?.message || 'API 密钥保存失败。')
      if (form.getSnapshot().value?.newApiAccount?.id !== userId) throw new Error('当前账户已更换，请重新同步。')
      const chats = await writeChatRoutes(modelForm, userId, eligible)
      const latest = form.getSnapshot()
      if (latest.value?.newApiAccount?.id !== userId) {
        await writeChatRoutes(modelForm, userId, [], true)
        throw new Error('当前账户已更换，请重新同步。')
      }
      if (!await form.mutate([{ op: 'set', path: ['newApiAccount'], value: { ...latest.value.newApiAccount, chatSyncVersion: 1 } }], latest.revision)) throw new Error('对话模型同步状态未保存，请重试。')
      return chats
    }

    function newApiAccount(user, status) {
      return {
        id: user.id,
        username: typeof user.username === 'string' ? user.username : '',
        displayName: typeof user.display_name === 'string' ? user.display_name : '',
        quota: typeof user.quota === 'number' && Number.isFinite(user.quota) ? user.quota : null,
        currency: typeof status?.quota_display_type === 'string' ? status.quota_display_type : '',
        quotaPerUnit: typeof status?.quota_per_unit === 'number' ? status.quota_per_unit : null,
        exchangeRate: typeof status?.usd_exchange_rate === 'number' ? status.usd_exchange_rate : null,
        customRate: typeof status?.custom_currency_exchange_rate === 'number' ? status.custom_currency_exchange_rate : null,
        customSymbol: typeof status?.custom_currency_symbol === 'string' ? status.custom_currency_symbol : '',
        updatedAt: Date.now(),
      }
    }

    function formatNewApiBalance(account) {
      if (!Number.isFinite(account.quota)) return '暂不可用'
      if (account.currency === 'TOKENS') return `${new Intl.NumberFormat('zh-CN').format(account.quota)} 额度`
      if (!Number.isFinite(account.quotaPerUnit) || account.quotaPerUnit <= 0) return `${new Intl.NumberFormat('zh-CN').format(account.quota)} 额度`
      const currency = account.currency
      const rate = currency === 'USD' ? 1 : currency === 'CNY' ? account.exchangeRate : currency === 'CUSTOM' ? account.customRate : null
      const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : currency === 'CUSTOM' ? account.customSymbol : ''
      if (!Number.isFinite(rate) || rate <= 0 || !symbol) return `${new Intl.NumberFormat('zh-CN').format(account.quota)} 额度`
      return `${symbol}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(account.quota / account.quotaPerUnit * rate)}`
    }

    function isExpiredNewApiSession(error) {
      return ['登录会话已失效，请重新登录。', '未找到可恢复的登录会话，请重新登录。', '登录会话无效，请重新登录。', '账户信息已变化，请重新登录。'].includes(error?.message)
    }

    async function ensureChatTimeouts(form, modelForm, userId) {
      if (form.getSnapshot().value?.newApiAccount?.id !== userId || typeof modelForm.getSnapshot !== 'function') return
      const snapshot = modelForm.getSnapshot()
      if (snapshot.status !== 'ready' || !snapshot.writable) return
      const ops = []
      for (const route of chatRoutes) {
        const id = chatRouteId(userId, route.id)
        const profile = snapshot.value?.providers?.[id]
        if (!managedChatRoute(profile) || profile.apiKeyEnv !== `DEEPIMAGE_NEWAPI_${userId}`) continue
        if (profile.timeoutMs !== undefined && profile.streamIdleTimeoutMs !== undefined) continue
        ops.push({ op: 'set', path: ['providers', id], value: { timeoutMs: 300000, streamIdleTimeoutMs: 300000, ...profile } })
      }
      if (ops.length && !await modelForm.mutate(ops, snapshot.revision)) throw new Error('对话模型超时配置未保存。')
    }

    async function clearExpiredNewApiAccount(form, modelForm, userId) {
      const before = form.getSnapshot()
      if (before.value?.newApiAccount?.id !== userId) return ''
      if (before.status !== 'ready' || !before.writable) throw new Error('登录已失效，但当前配置不可写，请检查配置后重试。')
      await newApiRequest('/api/user/auth/forget', { body: { userId } })
      newApiSession = null
      let routeError = ''
      try { await writeChatRoutes(modelForm, userId, [], true) }
      catch (error) { if (before.value.newApiAccount.chatRoutesManaged || before.value.newApiAccount.chatSyncVersion === 1) routeError = error.message || '对话模型配置未移除。' }
      newApiNotice = routeError ? `登录已失效，请重新登录；${routeError}` : '登录已失效，请重新登录。'
      let saved = false
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        const snapshot = form.getSnapshot()
        if (!snapshot.value?.newApiAccount) { saved = true; break }
        if (snapshot.value.newApiAccount.id !== userId) return ''
        if (!snapshot.writable) break
        saved = await form.mutate([{ op: 'set', path: ['newApiAccount'], value: null }], snapshot.revision)
      }
      if (!saved) throw new Error('登录已失效，但退出状态未保存，请检查配置后重试。')
      return routeError
    }

    function NewApiLogin({ form, credentials, modelForm, modelReady, account, onBusyChange, background = false }) {
      const [username, setUsername] = React.useState('')
      const [password, setPassword] = React.useState('')
      const [code, setCode] = React.useState('')
      const [challenge, setChallenge] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const busyRef = React.useRef(false)
      const retryAccount = React.useRef(null)
      const setAccountBusy = value => { setBusy(value); onBusyChange(value) }
      const [message, setMessage] = React.useState(() => newApiNotice)
      const [sessionExpired, setSessionExpired] = React.useState(null)
      const submit = async event => {
        event.preventDefault()
        if (busyRef.current) return
        busyRef.current = true
        setAccountBusy(true); setMessage('')
        try {
          await withNewApiLock(async () => {
          const response = challenge
            ? await newApiRequest('/api/user/login/verify', { body: { flow_token: challenge.flow_token, method: '2fa', code: code.trim() } })
            : await newApiRequest('/api/user/login', { body: { username: username.trim(), password } })
          setPassword(''); setCode('')
          if (response.data?.require_verification) {
            if (!response.data.methods?.some(item => item.method === '2fa' && item.available)) throw new Error('此账号需要其他登录验证方式，请联系站点管理员。')
            setChallenge(response.data)
          } else {
            setChallenge(null)
            let result
            try { result = await configureNewApi(response.data, form, credentials, modelForm) }
            catch (error) {
              const id = response.data?.user?.id
              if (Number.isSafeInteger(id) && id > 0 && form.getSnapshot().value?.newApiAccount?.id !== id) {
                try { await newApiRequest('/api/user/auth/forget', { body: { userId: id } }) }
                catch { throw new Error('登录配置失败，且本地登录凭据未清理，请重试。') }
              }
              throw error
            }
            newApiNotice = ''
            setSessionExpired(false)
            setMessage(result.chatError ? `连接成功，图片和视频模型已配置；对话模型同步失败：${result.chatError}` : `连接成功：已同步 ${result.chats} 个对话模型、${result.images} 个图片模型和 ${result.videos} 个视频模型。`)
          }
          })
        } catch (error) { setChallenge(null); setPassword(''); setCode(''); setMessage(error.message || '连接失败，请稍后重试。') } finally { busyRef.current = false; setAccountBusy(false) }
      }
      const refresh = async (mode = 'restore') => {
        if (busyRef.current) return
        busyRef.current = true; setAccountBusy(true); setMessage(mode === 'sync' ? '正在同步模型…' : mode === 'balance' ? '正在刷新余额…' : '')
        try {
          await withNewApiLock(async () => {
          try {
          const restoreSession = async () => {
            const response = await newApiRequest('/api/user/auth/refresh', { body: { userId: account.id } })
            const session = response.data
            if (session?.user?.id !== account.id || typeof session.access_token !== 'string' || !Number.isFinite(session.access_expires_at) || session.access_expires_at * 1000 <= Date.now()) throw new Error('登录会话无效，请重新登录。')
            newApiSession = { token: session.access_token, id: account.id, expiresAt: session.access_expires_at * 1000 }
          }
          if (!newApiSession || newApiSession.id !== account.id || !(newApiSession.expiresAt > Date.now() + 30000)) await restoreSession()
          let activeSession = newApiSession
          let self
          try { self = await newApiRequest('/api/user/self', { token: activeSession.token }) }
          catch (error) {
            if (!isExpiredNewApiSession(error)) throw error
            await restoreSession()
            activeSession = newApiSession
            self = await newApiRequest('/api/user/self', { token: activeSession.token })
          }
          if (self.data?.id !== account.id) throw new Error('账户信息已变化，请重新登录。')
          const snapshot = form.getSnapshot()
          if (snapshot.value?.newApiAccount?.id !== account.id) throw new Error('当前登录会话已更换，请刷新页面。')
          try { await ensureChatTimeouts(form, modelForm, account.id) } catch { /* Retry on the next session check. */ }
          if (mode === 'background') { setSessionExpired(false); return }
          const status = await newApiRequest('/api/status')
          const ok = await form.mutate([{ op: 'set', path: ['newApiAccount'], value: { ...newApiAccount(self.data, status.data), chatSyncVersion: snapshot.value.newApiAccount.chatSyncVersion || 0, chatRoutesManaged: !!snapshot.value.newApiAccount.chatRoutesManaged } }], snapshot.revision)
          if (!ok) throw new Error('余额未更新，请重试。')
          setSessionExpired(false)
          if (mode === 'sync') {
            const result = await configureNewApi({ access_token: activeSession.token, access_expires_at: activeSession.expiresAt / 1000, user: self.data }, form, credentials, modelForm, account.id, { user: self.data, status: status.data })
            setMessage(result.chatError ? `图片和视频模型已更新；对话模型同步失败：${result.chatError}` : `模型同步完成：${result.chats} 个对话模型、${result.images} 个图片模型、${result.videos} 个视频模型。`)
          } else if (snapshot.value.newApiAccount.chatSyncVersion !== 1) {
            const chats = await syncExistingChat({ access_token: activeSession.token, access_expires_at: activeSession.expiresAt / 1000, user: self.data }, form, credentials, modelForm)
            setMessage(`已同步 ${chats} 个对话模型。`)
          } else if (mode === 'balance') setMessage('余额已更新。')
          } catch (error) {
            if (!isExpiredNewApiSession(error)) throw error
            const routeError = await clearExpiredNewApiAccount(form, modelForm, account.id)
            setSessionExpired(false); setChallenge(null); setPassword(''); setCode('')
            setMessage(routeError ? `登录已失效，请重新登录；${routeError}` : '登录已失效，请重新登录。')
          }
          })
        } catch (error) {
          if (/登录会话.*(?:重新登录|失效|无效)/.test(error.message || '')) setSessionExpired(true)
          else setSessionExpired(null)
          setMessage(error.message || (mode === 'sync' ? '模型同步失败，请稍后重试。' : '刷新余额失败，请稍后重试。'))
        } finally { busyRef.current = false; setAccountBusy(false) }
      }
      const logout = async () => {
        if (busyRef.current) return
        if (!form.getSnapshot().writable) { setMessage('当前配置不可写，无法退出登录。'); return }
        busyRef.current = true; setAccountBusy(true); setMessage('')
        try {
          await withNewApiLock(async () => {
          await newApiRequest('/api/user/auth/logout', { body: { userId: account.id } })
          let routeError = ''
          const currentAccount = form.getSnapshot().value?.newApiAccount
          try { await writeChatRoutes(modelForm, account.id, [], true) } catch (error) { if (currentAccount?.chatRoutesManaged || currentAccount?.chatSyncVersion === 1) routeError = error.message || '对话模型配置未移除。' }
          if (routeError) throw new Error(`会话已退出，但${routeError} 请再次点击退出登录。`)
          newApiSession = null
          setSessionExpired(true)
          let saved = false
          for (let attempt = 0; attempt < 3 && !saved; attempt++) {
            const snapshot = form.getSnapshot()
            if (!snapshot.value?.newApiAccount) { saved = true; break }
            if (snapshot.value.newApiAccount.id !== account.id) throw new Error('当前登录会话已更换，请刷新页面。')
            if (!snapshot.writable) break
            saved = await form.mutate([{ op: 'set', path: ['newApiAccount'], value: null }], snapshot.revision)
          }
          if (!saved) throw new Error('会话已退出，但配置未保存，请再次点击退出登录。')
          newApiNotice = ''
          setChallenge(null); setPassword(''); setCode(''); setSessionExpired(false)
          setMessage(routeError ? `已退出登录；${routeError}` : '已退出登录。')
          })
        } catch (error) { newApiSession = null; setSessionExpired(true); setMessage(error.message || '退出登录失败，请稍后重试。') }
        finally { busyRef.current = false; setAccountBusy(false) }
      }
      const icon = (label, paths, onClick) => h('button', { type: 'button', className: 'media-account-icon', disabled: busy || (label === '退出登录' && !form.getSnapshot().writable), onClick, title: label, 'aria-label': label },
        h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, ...paths.map((d, index) => h('path', { d, key: index }))))
      React.useEffect(() => { if (account?.id) void refresh() }, [account?.id])
      React.useEffect(() => {
        if (!background || !account?.id) return
        const timer = setInterval(() => { void refresh('background') }, 60000)
        return () => clearInterval(timer)
      }, [account?.id, background])
      React.useEffect(() => { if (!account?.id && newApiNotice) setMessage(newApiNotice) }, [account?.id])
      React.useEffect(() => {
        if (account?.id && account.chatSyncVersion !== 1 && modelReady && !busy && !busyRef.current && retryAccount.current !== account.id) {
          retryAccount.current = account.id
          void refresh()
        }
      }, [account?.id, account?.chatSyncVersion, modelReady, busy])
      if (account) {
        const name = account.username || 'New API 用户'
        const connection = sessionExpired === null ? '连接状态待确认' : sessionExpired ? '需要重新登录' : '已连接'
        const updated = Number.isFinite(account.updatedAt) ? new Date(account.updatedAt).toLocaleString('zh-CN', { hour12: false }) : ''
        return h('section', { className: 'media-newapi media-newapi-account', 'aria-label': 'New API 账户' },
          h('div', { className: 'media-account-main' },
            h('div', { className: 'media-account-avatar' }, h('span', { 'aria-hidden': true }, Array.from(name.trim())[0]?.toUpperCase() || '?'), h('span', { className: `media-account-indicator ${sessionExpired === false ? 'is-connected' : sessionExpired === true ? 'is-expired' : ''}`, role: 'img', 'aria-label': connection, title: connection })),
            h('div', { className: 'media-account-name' }, h('strong', null, name)),
            h('div', { className: 'media-account-balance' }, h('span', { className: 'media-account-label' }, '可用余额'), h('strong', null, formatNewApiBalance(account)), updated && h('span', { className: 'media-account-updated' }, `更新于 ${updated}`)),
            h('div', { className: 'media-account-actions' },
              icon('刷新余额', ['M20 7v5h-5', 'M4 17v-5h5', 'M5.6 9a7 7 0 0 1 11.9-2L20 12', 'M4 12l2.5 5a7 7 0 0 0 11.9-2'], () => refresh('balance')),
              icon('同步模型', ['M4 7h10', 'M11 4l3 3-3 3', 'M20 17H10', 'M13 14l-3 3 3 3', 'M18 4v6', 'M15 7h6', 'M4 14v6'], () => refresh('sync')),
              icon('退出登录', ['M10 17l5-5-5-5', 'M15 12H3', 'M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6'], logout))),
          message && h('p', { role: 'status' }, message))
      }
      return h('form', { className: 'media-newapi', onSubmit: submit },
        h('div', null, h('h3', null, '连接 New API'), h('p', null, '登录 AIKNA 后自动配置兼容模型。首次连接会创建名为 deepImage 的 API 密钥；密钥不设独立额度或有效期，调用使用账户额度，可在 New API 中管理。')),
        challenge ? h('label', null, '两步验证码或备用码', h('input', { required: true, autoComplete: 'one-time-code', value: code, onChange: e => setCode(e.target.value) }))
          : h(React.Fragment, null,
              h('label', null, '用户名或邮箱', h('input', { required: true, autoComplete: 'username', value: username, onChange: e => setUsername(e.target.value) })),
              h('label', null, '密码', h('input', { required: true, type: 'password', autoComplete: 'current-password', value: password, onChange: e => setPassword(e.target.value) }))),
        h('div', { className: 'media-newapi-actions' }, challenge && h('button', { type: 'button', className: 'media-form-button', disabled: busy, onClick: () => { setChallenge(null); setCode('') } }, '返回'), h('button', { type: 'submit', className: 'media-form-button media-form-primary', disabled: busy }, busy ? '连接中…' : challenge ? '验证并连接' : '登录并连接')),
        message && h('p', { role: 'status' }, message))
    }

    function NewApiSessionMonitor({ form, credentials, modelForm }) {
      const snapshot = React.useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form), form.getSnapshot.bind(form))
      const modelSnapshot = React.useSyncExternalStore(modelForm.subscribe.bind(modelForm), modelForm.getSnapshot.bind(modelForm), modelForm.getSnapshot.bind(modelForm))
      if (snapshot.status !== 'ready') return null
      return h('div', { hidden: true }, h(NewApiLogin, { form, credentials, modelForm, modelReady: modelSnapshot.status === 'ready' && modelSnapshot.writable, account: snapshot.value?.newApiAccount, onBusyChange: () => {}, background: true }))
    }

    let updateRemote
    let updateManager
    const updateCodec = { mode: 'strict', typeSymbol: 'deepimage#update-request', create: () => ({ parse: value => value }) }
    const updateDescriptor = { id: 'deepimage/update-request', service: 'deepImageUpdate', namespace: 'deepImageUpdate', method: 'request', invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: updateCodec }], result: { mode: 'strict', typeSymbol: 'deepimage#update-response', create: () => ({ parse: value => value }) } }
    async function updateRequest(input) {
      if (!updateRemote?.deepImageUpdate) throw new Error('更新服务尚未就绪，请稍后重试。')
      const response = await updateRemote.deepImageUpdate.request(input)
      if (!response.ok) throw new Error(response.error?.message || '更新请求失败。')
      return response.value
    }

    const updatePendingKey = 'deepimage-update-pending'
    function readPendingUpdate() {
      try {
        const value = JSON.parse(sessionStorage.getItem(updatePendingKey) || 'null')
        return typeof value?.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version) ? value : null
      } catch { return null }
    }
    function writePendingUpdate(value) {
      try { if (value) sessionStorage.setItem(updatePendingKey, JSON.stringify(value)); else sessionStorage.removeItem(updatePendingKey) } catch {}
    }

    function UpdatePanel() {
      const [status, setStatus] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const busyRef = React.useRef(false)
      React.useEffect(() => {
        const pending = readPendingUpdate()
        if (!pending) return
        let active = true, timer, attempts = 0
        setMessage('正在确认更新结果…')
        const recover = async () => {
          try {
            const current = await updateRequest({ action: 'status' })
            if (!active) return
            if (current.version === pending.version) {
              writePendingUpdate(null)
              setMessage(`已更新到 ${pending.version}。`)
              return
            }
          } catch {}
          if (!active) return
          if (++attempts < 12) timer = setTimeout(recover, 250)
          else { writePendingUpdate(null); setMessage('未能确认更新结果，请重新检查版本。') }
        }
        void recover()
        return () => { active = false; clearTimeout(timer) }
      }, [])
      const check = async () => {
        if (busyRef.current) return
        busyRef.current = true; setBusy(true); setMessage('')
        try {
          const value = await updateRequest({ action: 'check' })
          setStatus(value)
          setMessage(value.available ? `发现新版本 ${value.latest}。` : `当前已是最新版本 ${value.version}。`)
        } catch (error) { setStatus(null); setMessage(error.message || '检查更新失败，请重试。') }
        finally { busyRef.current = false; setBusy(false) }
      }
      const install = async () => {
        if (busyRef.current || !status?.available) return
        busyRef.current = true; setBusy(true); setMessage('正在下载并校验更新…')
        try {
          const prepared = await updateRequest({ action: 'prepare', version: status.latest })
          if (!updateManager) throw new Error('当前 Harness 未提供插件管理服务。')
          setMessage('正在安装更新，请稍候…')
          writePendingUpdate({ version: prepared.version })
          const result = await updateManager.installBundle(prepared.path, { enabled: prepared.enabled })
          if (!result.ok) throw new Error(result.error?.message || '插件更新失败。')
          const value = result.value
          if (value.application === 'failed' || value.application === 'cancelled' || value.error) throw new Error(value.error?.message || '插件更新失败，请在插件管理器中查看详情。')
          setStatus(null)
          if (value.application !== 'applied') writePendingUpdate(null)
          setMessage(value.application === 'applied' ? `已更新到 ${prepared.version}。` : value.application === 'overridden' ? '更新已保存，但被其他配置覆盖，请在插件管理器中检查。' : `已安装 ${prepared.version}，请重启 DeepSeek Harness 以完成更新。`)
        } catch (error) { writePendingUpdate(null); setMessage(error.message || '更新失败，请重试。') }
        finally { busyRef.current = false; setBusy(false) }
      }
      return h('section', { className: 'media-update', 'aria-label': '插件更新' },
        h('div', { className: 'media-update-head' }, h('div', null, h('strong', null, '插件更新'), h('p', null, status ? `当前 ${status.version} · ${status.edition === 'newapi' ? 'New API 公司版' : '开源版'}` : '检查当前版本的更新。')),
          status?.available ? h('button', { type: 'button', className: 'media-form-button media-form-primary', disabled: busy, onClick: install }, busy ? '处理中…' : `更新到 ${status.latest}`) : h('button', { type: 'button', className: 'media-form-button', disabled: busy, onClick: check }, busy ? '检查中…' : '检查更新')),
        message && h('p', { className: 'media-update-message', role: 'status' }, message))
    }

    function GeneratedImage({ attachment, loadImage }) {
      const [url, setUrl] = React.useState(() => loadImage.peek?.(attachment) || '')
      const [failed, setFailed] = React.useState(false)
      React.useEffect(() => {
        let active = true
        setUrl(loadImage.peek?.(attachment) || '')
        setFailed(false)
        loadImage(attachment).then(value => { if (active) setUrl(value) }, () => { if (active) setFailed(true) })
        return () => { active = false }
      }, [attachment, loadImage])
      return url && !failed ? h('img', { className: 'deepimage-result-image', src: url, alt: '生成的图片', onError: () => setFailed(true) })
        : h('p', null, failed ? '图片加载失败，请查看工具详情。' : '正在加载图片…')
    }

    function GeneratedUrlImage({ url }) {
      const [failed, setFailed] = React.useState(false)
      React.useEffect(() => { setFailed(false) }, [url])
      return failed ? h('p', null, '图片链接已失效或无法访问，请查看工具详情。')
        : h('img', { src: url, alt: '生成的图片', loading: 'lazy', onError: () => setFailed(true) })
    }

    function generatedImages(calls) {
      const images = []
      const visit = call => {
        if (!call) return
        const imageResult = call.name === 'generate_image' || (!call.name && (call.content || []).some(part => part?.type === 'text' && typeof part.text === 'string' && /^Image generated with .+\./.test(part.text)))
        if (call.kind === 'tool-result' && imageResult && !call.isError) {
          const attachments = (call.content || []).filter(part => part?.type === 'image' && part.attachment).map(part => part.attachment)
          if (attachments.length) attachments.forEach(attachment => images.push({ attachment, key: `${call.callId}:${attachment.attachmentId}` }))
          else for (const part of call.content || []) {
            const match = part?.type === 'text' && typeof part.text === 'string' && /^Image URL: (https?:\/\/\S+)$/m.exec(part.text)
            if (match) images.push({ url: match[1], key: `${call.callId}:${match[1]}` })
          }
        }
        for (const child of call.subCalls || []) visit(child)
      }
      for (const entry of calls) visit(entry.root)
      return images
    }

    function TurnGeneratedImages({ turn, sessionId, useChat, uiConversation }) {
      const nodes = useChat(snapshot => snapshot.nodes)
      const source = React.useMemo(() => nodes.turnDataSource(turn.turn, 'tool-call'), [nodes, turn.turn])
      const calls = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
      const loadImage = React.useMemo(() => Object.assign(
        attachment => uiConversation.imageUrl(sessionId, attachment),
        { peek: attachment => uiConversation.peekImageUrl(sessionId, attachment) },
      ), [uiConversation, sessionId])
      const images = generatedImages(calls)
      if (!images.length) return null
      return h('div', { className: 'deepimage-turn-images', 'aria-label': '生成的图片' },
        h('style', null, '.deepimage-turn-images{display:flex;flex-wrap:wrap;gap:12px}.deepimage-turn-images img{display:block;max-width:min(356px,100%);max-height:500px;width:auto;height:auto;border-radius:12px}.deepimage-turn-images p{color:var(--dsw-alias-label-secondary,#6b7280)}'),
        ...images.map(image => image.attachment
          ? h(GeneratedImage, { key: image.key, attachment: image.attachment, loadImage })
          : h(GeneratedUrlImage, { key: image.key, url: image.url })))
    }

    function ImageToolView({ phase, block, loadImage, inspect }) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (phase !== 'start') return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [phase, block.callId])
      const progress = Math.min(95, Math.floor(95 * (1 - Math.exp(-Math.max(0, now - block.time) / 60000))))
      const content = phase === 'result' && Array.isArray(block.content) ? block.content : []
      return h('div', { className: 'deepimage-tool' },
        h('style', null, `
          .deepimage-tool{max-width:356px;margin:8px 0;color:var(--dsw-alias-label-primary,inherit);font:var(--dsw-font-s-14,14px/22px sans-serif)}
          .deepimage-loading{position:relative;overflow:hidden;width:100%;aspect-ratio:1;border-radius:30px;background:var(--dsw-alias-settings-card-fill,#f2f2f2)}
          .deepimage-dots{position:absolute;inset:0;background-image:radial-gradient(circle,rgba(90,97,110,.43) 1px,transparent 1.2px);background-size:12px 12px;mask-image:radial-gradient(ellipse at 67% 48%,#000 0%,transparent 70%);-webkit-mask-image:radial-gradient(ellipse at 67% 48%,#000 0%,transparent 70%);animation:deepimage-pulse 3s ease-in-out infinite alternate}
          .deepimage-status{position:absolute;right:28px;bottom:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:112px;min-height:58px;padding:6px 14px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l4,#dedede);border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 4px 12px rgba(0,0,0,.06);color:var(--dsw-alias-brand-text,#0068cf)}
          .deepimage-percent{font-size:28px;line-height:30px;font-variant-numeric:tabular-nums}.deepimage-estimate{font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary,#6b7280)}
          .deepimage-result{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,inherit)}.deepimage-result p{margin:4px 0;white-space:pre-wrap}.deepimage-result-image{display:block;max-width:100%;height:auto;border-radius:12px;margin:8px 0}.deepimage-inspect{font:inherit;color:inherit;background:transparent;border:0;padding:4px 0;cursor:pointer;text-decoration:underline}
          @keyframes deepimage-pulse{from{opacity:.45;transform:scale(.98)}to{opacity:1;transform:scale(1.02)}}
          @media(prefers-reduced-motion:reduce){.deepimage-dots{animation:none}}
        `),
        phase !== 'result'
          ? h('div', { className: 'deepimage-loading', role: 'status', 'aria-label': phase === 'start' ? '正在生成图片，显示的百分比为估算进度' : '正在准备生成图片' },
              h('div', { className: 'deepimage-dots', 'aria-hidden': true }),
              h('div', { className: 'deepimage-status', 'aria-hidden': true },
                phase === 'start' ? h(React.Fragment, null, h('span', { className: 'deepimage-percent' }, `${progress}%`), h('span', { className: 'deepimage-estimate' }, '估算进度')) : h('span', null, '准备中…')))
          : h('div', { className: 'deepimage-result' },
              h('strong', null, block.isError ? '图片生成失败' : '图片生成完成'),
              ...content.filter(part => block.isError || part?.type !== 'image').map((part, index) => part?.type === 'image' && part.attachment
                ? h(GeneratedImage, { key: index, attachment: part.attachment, loadImage })
                : part?.type === 'text' && typeof part.text === 'string'
                  ? h('p', { key: index }, part.text)
                  : h('p', { key: index }, JSON.stringify(part))),
              inspect && h('button', { type: 'button', className: 'deepimage-inspect', onClick: inspect }, '查看工具详情')))
    }

    function MediaSettings({ form, credentials, modelForm }) {
      const snapshot = React.useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form), form.getSnapshot.bind(form))
      const modelSnapshot = React.useSyncExternalStore(modelForm.subscribe.bind(modelForm), modelForm.getSnapshot.bind(modelForm), modelForm.getSnapshot.bind(modelForm))
      const [editor, setEditor] = React.useState(null)
      const [secret, setSecret] = React.useState('')
      const [body, setBody] = React.useState('')
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [openMenu, setOpenMenu] = React.useState(null)
      const [activeKind, setActiveKind] = React.useState('image')
      const [accountBusy, setAccountBusy] = React.useState(false)
      const value = snapshot.value || {}
      const shownKind = value.newApiAccount ? activeKind : 'settings'
      React.useEffect(() => { if (!value.newApiAccount) { setEditor(null); setSecret(''); setError('') } }, [value.newApiAccount?.id])
      const open = (kind, provider, index) => {
        setEditor({ kind, index, revision: snapshot.revision, data: { ...defaults(kind), ...(provider || {}) }, timeoutText: provider?.timeoutMs > 0 ? String(provider.timeoutMs / 1000) : '', statusText: { successStatuses: (provider?.successStatuses ?? ['succeeded', 'completed']).join(', '), failureStatuses: (provider?.failureStatuses ?? ['failed', 'error', 'cancelled', 'expired']).join(', ') } })
        setBody(provider?.requestBody ? JSON.stringify(provider.requestBody, null, 2) : '')
        setSecret(''); setError('')
      }
      const change = (key, next) => setEditor(old => ({ ...old, data: { ...old.data, [key]: next } }))
      const save = async (event) => {
        event.preventDefault()
        if (busy || !editor) return
        setError('')
        const { kind, index, data, revision } = editor
        const listKey = kind === 'image' ? 'imageProviders' : 'videoProviders'
        const list = value[listKey] || []
        try {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(data.apiKeyEnv)) throw new Error('凭据引用只能包含字母、数字和下划线，且不能以数字开头。')
          if (!data.id.trim() || !data.model.trim()) throw new Error('请填写服务商 ID 和模型 ID。')
          if (list.some((item, i) => item.id === data.id && i !== index)) throw new Error('该类型下的服务商 ID 已存在。')
          for (const address of [data.endpoint, ...(kind === 'video' ? [data.statusEndpointTemplate.replace('{taskId}', 'task')] : [])]) {
            const parsed = new URL(address)
            if (parsed.username || parsed.password || parsed.hash) throw new Error('API 地址不能包含用户名、密码或片段。')
            if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && (data.allowInsecureHttp || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) throw new Error('API 地址需要使用 HTTPS；仅在临时调试时开启 HTTP 选项。')
          }
          if (kind === 'video' && !data.statusEndpointTemplate.includes('{taskId}')) throw new Error('查询任务地址需要包含 {taskId}。')
          const next = { ...data }
          const timeoutText = editor.timeoutText.trim()
          if (timeoutText) {
            const seconds = Number(timeoutText)
            if (!/^\d+(?:\.\d{1,3})?$/.test(timeoutText) || !Number.isFinite(seconds) || seconds < 1 || seconds > 2147483.647) throw new Error('超时时间需为 1 至 2147483.647 秒，最多保留三位小数。')
            next.timeoutMs = Math.round(seconds * 1000)
          } else delete next.timeoutMs
          if (kind === 'video') {
            for (const key of ['successStatuses', 'failureStatuses']) next[key] = editor.statusText[key].split(',').map(x => x.trim()).filter(Boolean)
          }
          if (body.trim()) {
            try { next.requestBody = JSON.parse(body) } catch { throw new Error('请求体不是有效的 JSON。') }
          } else delete next.requestBody
          setBusy(true)
          if (secret) {
            const result = await credentials.set(data.apiKeyEnv, secret)
            if (!result.ok) throw new Error(result.error?.message || '密钥保存失败。')
          }
          const updated = [...list]
          if (index === null) updated.push(next); else updated[index] = next
          const ops = [{ op: 'set', path: [listKey], value: updated }]
          if (kind === 'image' && index !== null && list[index]?.id === value.defaultImageProvider && list[index].id !== next.id) ops.push({ op: 'set', path: ['defaultImageProvider'], value: next.id })
          const ok = await form.mutate(ops, revision)
          if (!ok) throw new Error('配置未保存，可能已被其他页面修改。请重新打开后再试。')
          setEditor(null); setSecret('')
        } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
      }
      const remove = async (kind, index) => {
        if (busy) return
        setBusy(true); setError('')
        try {
          const key = kind === 'image' ? 'imageProviders' : 'videoProviders'
          const list = value[key] || []
          const ops = [{ op: 'set', path: [key], value: list.filter((_, i) => i !== index) }]
          if (kind === 'image' && list[index]?.id === value.defaultImageProvider) ops.push({ op: 'set', path: ['defaultImageProvider'], value: '' })
          const ok = await form.mutate(ops, snapshot.revision)
          if (!ok) throw new Error('删除未保存，请刷新后重试。')
        } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
      }
      const setDefault = async (id) => {
        if (busy) return
        setBusy(true); setError('')
        try {
          const ok = await form.mutate([{ op: 'set', path: ['defaultImageProvider'], value: id }], snapshot.revision)
          if (!ok) throw new Error('默认服务商未保存，请刷新后重试。')
        } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
      }
      const section = (kind, title) => {
        const list = (value[kind === 'image' ? 'imageProviders' : 'videoProviders'] || []).map((provider, index) => ({ provider, index })).filter(({ provider }) => { const idOwner = /^newapi:(\d+):/.exec(provider.id)?.[1]; const credentialOwner = /^DEEPIMAGE_NEWAPI_(\d+)$/.exec(provider.apiKeyEnv)?.[1]; const activeId = String(value.newApiAccount?.id || ''); return (!idOwner || idOwner === activeId) && (!credentialOwner || credentialOwner === activeId) })
        return h('section', { className: 'media-section', key: kind },
          h('div', { className: 'media-heading' },
            h('div', null, h('h3', null, title), h('p', { className: 'media-section-description' }, kind === 'image' ? '用于在对话中生成图片' : '用于创建和查询视频任务')),
            h('button', { type: 'button', className: 'media-add', disabled: !snapshot.writable || busy || accountBusy, onClick: () => open(kind, null, null) }, h('span', { 'aria-hidden': true }, '+'), '添加服务商')),
          list.length ? h('div', { className: 'media-card-list' }, list.map(({ provider, index }) => h('article', { className: 'media-card', key: provider.id },
            h('div', { className: 'media-card-body' },
              h('div', { className: 'media-card-identity' }, h('strong', null, provider.model), kind === 'image' && value.defaultImageProvider === provider.id && h('span', { className: 'media-badge' }, '默认')),
              h('div', { className: 'media-card-meta' },
                h('div', null, h('span', null, '凭据引用'), h('span', { title: provider.apiKeyEnv }, provider.apiKeyEnv)))),
            h('div', { className: 'media-card-actions' },
              h('button', { type: 'button', className: 'media-edit', disabled: busy || accountBusy || !snapshot.writable, onClick: () => open(kind, provider, index) }, '编辑'),
              h(Menu, {
                open: openMenu === `${kind}:${provider.id}`,
                onClose: () => setOpenMenu(null), align: 'end', portal: true, autoFocus: true,
                anchor: h('button', { type: 'button', className: 'media-more', disabled: busy || accountBusy || !snapshot.writable, 'aria-label': `${provider.model}（${provider.apiKeyEnv}）的更多操作`, 'aria-haspopup': 'menu', 'aria-expanded': openMenu === `${kind}:${provider.id}`, onClick: () => setOpenMenu(current => current === `${kind}:${provider.id}` ? null : `${kind}:${provider.id}`) }, '•••'),
              },
              kind === 'image' && value.defaultImageProvider !== provider.id && h(MenuItemButton, { onSelect: () => { setOpenMenu(null); setDefault(provider.id) } }, '设为默认'),
              h(MenuItemButton, { onSelect: () => { setOpenMenu(null); remove(kind, index) } }, '删除服务商')))))) : h('div', { className: 'media-empty' }, '暂无服务商，添加后即可使用。'))
      }
      return h('div', { className: 'media-settings' },
        h('style', null, `
          .media-settings{max-width:720px;padding:24px;color:var(--dsw-alias-label-primary,inherit);font:var(--dsw-font-s-14,14px/22px sans-serif)}
          .media-settings h2{margin:0;font:var(--dsw-font-xl-24,600 24px/32px sans-serif)}
          .media-settings h3,.media-settings p{margin:0}
          .media-settings button,.media-settings input,.media-settings textarea,.media-settings summary{font:inherit;color:inherit}
          .media-settings button{cursor:pointer}
          .media-settings button:disabled{opacity:.45;cursor:not-allowed}
          .media-settings button:focus-visible,.media-settings summary:focus-visible,.media-settings input:focus-visible,.media-settings textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}
          .media-update{margin-top:20px;padding:14px 16px;border:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb);border-radius:var(--dsw-radius-md,12px)}.media-update-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.media-update p{color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px;line-height:20px}.media-update-message{margin-top:10px!important;overflow-wrap:anywhere}
          .media-intro{margin-top:8px!important;color:var(--dsw-alias-label-secondary,#6b7280);max-width:48ch}
          .media-tabs{display:flex;gap:24px;margin-top:24px;border-bottom:1px solid var(--dsw-alias-border-l4,#e2e5eb)}
          .media-tab{position:relative;padding:8px 2px 12px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280)!important}
          .media-tab[aria-selected=true]{color:var(--dsw-alias-label-primary,inherit)!important;font-weight:600}
          .media-tab[aria-selected=true]::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary,#4d6bfe)}
          .media-section{margin-top:24px}
          .media-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}
          .media-heading h3{font:var(--dsw-font-base-strong-16,600 16px/24px sans-serif)}
          .media-section-description{color:var(--dsw-alias-label-tertiary,#858b98);font-size:13px;line-height:20px;margin-top:2px!important}
          .media-add,.media-form-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent);white-space:nowrap}
          .media-add span{font-size:18px;line-height:1}
          .media-add:hover,.media-form-button:hover,.media-edit:hover,.media-more:hover{background:var(--dsw-alias-interactive-bg-hover,#e9ebf0)}
          .media-card-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:10px}
          .media-card{position:relative;display:flex;flex-direction:column;min-width:0;border:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-settings-card-fill,#f7f8fa)}.media-card-body{flex:1;min-width:0;padding:16px 16px 18px}
                    .media-card-identity{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;padding-top:4px}
          .media-card-identity strong{font-weight:600;overflow-wrap:anywhere}
          .media-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;color:var(--dsw-alias-brand-text,#4263d9);background:var(--dsw-alias-interactive-bg-hover-accent,#e8edff);font-size:12px;line-height:20px;font-weight:500}
          .media-card-actions{display:flex;justify-content:flex-end;align-items:center;gap:4px;min-height:46px;padding:4px 10px;border-top:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb)}
          .media-edit,.media-more{display:inline-flex;align-items:center;justify-content:center;min-height:30px;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent}
          .media-edit{padding:0 9px;color:var(--dsw-alias-label-secondary,#5b6170)!important}
          .media-more{width:32px;letter-spacing:1px}
          .media-card-meta{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin-top:14px}.media-card-meta div{display:grid;gap:2px;min-width:0}.media-card-meta span:first-child{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#858b98)}.media-card-meta span:last-child{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#5b6170);overflow-wrap:anywhere}
          .media-empty{padding:20px;border:1px dashed var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-tertiary,#858b98)}
          .media-form{display:grid;gap:16px;margin-top:24px}.media-form h3{font:var(--dsw-font-base-strong-16,600 16px/24px sans-serif)}.media-form label{display:grid;gap:6px;color:var(--dsw-alias-label-secondary,#5b6170)}
          .media-form input:not([type=checkbox]),.media-form textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit)}.media-form textarea{min-height:100px;font-family:var(--ds-font-family-code,monospace)}
          .media-form details{padding:12px;border:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb);border-radius:var(--dsw-radius-sm,8px)}.media-form details summary{cursor:pointer}.media-form details label{margin-top:12px}
          .media-form-actions{display:flex;justify-content:flex-end;gap:8px}.media-form-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff)!important;border-color:transparent}.media-form-primary:hover{opacity:.9}
          .media-error{margin-top:16px!important;color:var(--dsw-alias-label-danger,#c44);white-space:pre-wrap}
          .media-newapi{display:grid;gap:12px;margin-top:20px;padding:16px;border:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-settings-card-fill,#f7f8fa)}.media-newapi h3{font-weight:600}.media-newapi p{color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px}.media-newapi label{display:grid;gap:4px;color:var(--dsw-alias-label-secondary,#6b7280)}.media-newapi input{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent)}.media-newapi-actions{display:flex;gap:8px}
          .media-newapi-account{gap:10px;position:relative}.media-account-main{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-right:122px}.media-account-avatar{position:relative;display:flex;align-items:center;justify-content:center;flex:none;width:48px;height:48px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover-accent,#e8edff);color:var(--dsw-alias-brand-text,#4263d9);font-size:20px;font-weight:600}.media-account-indicator{position:absolute;right:-1px;bottom:-1px;width:12px;height:12px;box-sizing:border-box;border:2px solid var(--dsw-alias-settings-card-fill,#fff);border-radius:50%;background:#a0a6b2}.media-account-indicator.is-connected{background:#22b66a}.media-account-indicator.is-expired{background:#e38a38}.media-account-name{display:grid;gap:1px;flex:1 1 125px;min-width:0;overflow-wrap:anywhere}.media-account-name strong{font-size:16px}.media-account-name span,.media-account-label,.media-account-updated{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}.media-account-balance{display:grid;gap:1px;min-width:115px}.media-account-balance strong{font-size:19px;line-height:26px;font-variant-numeric:tabular-nums}.media-account-updated{font-size:11px}.media-account-actions{position:absolute;right:16px;top:16px;display:flex;align-items:center;gap:4px}.media-account-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent)}.media-account-icon:hover{background:var(--dsw-alias-interactive-bg-hover,#e9ebf0)}.media-account-icon:active{transform:translateY(1px)}

          @media(max-width:600px){.media-settings{padding:16px}.media-card-meta{grid-template-columns:1fr;gap:8px}.media-heading{align-items:flex-start}.media-section-description{max-width:28ch}.media-account-main{padding-right:0}.media-account-actions{position:static;flex-basis:100%;justify-content:flex-end}}
        `),
        h('h2', null, 'deepImage'),
        h('p', { className: 'media-intro' }, '管理图片和视频服务商，选择用于自动绘图的默认服务商。'),
        snapshot.status === 'ready' && h('div', { hidden: !!editor }, h(NewApiLogin, { form, credentials, modelForm, modelReady: modelSnapshot.status === 'ready' && modelSnapshot.writable, account: value.newApiAccount, onBusyChange: setAccountBusy })),
        !editor && value.newApiAccount && snapshot.status === 'ready' && h('div', { className: 'media-tabs', role: 'tablist', 'aria-label': 'deepImage 页面' },
          ...(value.newApiAccount ? [['image', '绘图'], ['video', '视频'], ['settings', '设置']] : [['settings', '设置']]).map(([kind, label]) => h('button', {
            key: kind, id: `media-tab-${kind}`, type: 'button', className: 'media-tab', role: 'tab', 'aria-selected': shownKind === kind,
            'aria-controls': kind === 'settings' ? 'media-settings-panel' : 'media-provider-panel', tabIndex: shownKind === kind ? 0 : -1,
            onClick: () => { setOpenMenu(null); setError(''); setActiveKind(kind) },
            onKeyDown: e => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              const kinds = value.newApiAccount ? ['image', 'video', 'settings'] : ['settings']
              const next = kinds[(kinds.indexOf(kind) + (e.key === 'ArrowRight' ? 1 : -1) + kinds.length) % kinds.length]
              setOpenMenu(null); setError(''); setActiveKind(next)
              e.currentTarget.parentElement.querySelector(`[data-media-kind="${next}"]`)?.focus()
            }, 'data-media-kind': kind,
          }, label))),
        snapshot.status !== 'ready' ? h('p', null, snapshot.status === 'loading' ? '正在加载配置…' : '配置暂不可用。') : value.newApiAccount && !editor && shownKind !== 'settings' && h('div', { id: 'media-provider-panel', role: 'tabpanel', 'aria-labelledby': `media-tab-${shownKind}` }, section(shownKind, shownKind === 'image' ? '绘图服务商' : '视频服务商')),
        snapshot.status === 'ready' && h('div', { id: 'media-settings-panel', role: 'tabpanel', 'aria-labelledby': 'media-tab-settings', hidden: !!editor || !value.newApiAccount || shownKind !== 'settings' }, h(UpdatePanel)),
        value.newApiAccount && error && h('p', { className: 'media-error', role: 'alert' }, error),
        value.newApiAccount && editor && h('form', { className: 'media-form', onSubmit: save },
          h('h3', null, `${editor.index === null ? '添加' : '编辑'}${editor.kind === 'image' ? '绘图' : '视频'}服务商`),
          ...fields.slice(0, 4).map(([key, label, required]) => h('label', { key }, label, h('input', { value: editor.data[key] ?? '', required, onChange: e => change(key, e.target.value) }))),
          editor.kind === 'video' && h('label', null, '查询任务地址（包含 {taskId}）', h('input', { required: true, value: editor.data.statusEndpointTemplate ?? '', onChange: e => change('statusEndpointTemplate', e.target.value) })),
          h('label', null, 'API Key（留空使用已有凭据）', h('input', { type: 'password', autoComplete: 'new-password', value: secret, onChange: e => setSecret(e.target.value) })),
          h('label', null, '请求超时（秒）', h('input', { type: 'number', min: 1, max: 2147483.647, step: 0.001, inputMode: 'decimal', value: editor.timeoutText, placeholder: `留空使用默认值（${(!value.timeoutMs || Number(value.timeoutMs) === 60000 ? 300000 : Math.min(Number(value.timeoutMs), 2147483647)) / 1000} 秒）`, onChange: e => setEditor(old => ({ ...old, timeoutText: e.target.value })) })),
          h('details', null, h('summary', null, '高级设置'),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: !!editor.data.allowInsecureHttp, onChange: e => change('allowInsecureHttp', e.target.checked) }), '允许外部 HTTP（仅限调试；密钥会明文传输）'),
            ...[...fields.slice(4), ...(editor.kind === 'image' ? imageFields : videoFields.slice(1))].map(([key, label, required]) => h('label', { key }, label, h('input', { value: editor.data[key] ?? '', required, onChange: e => change(key, e.target.value) }))),
            ...(editor.kind === 'video' ? [['successStatuses', '成功状态（逗号分隔）'], ['failureStatuses', '失败状态（逗号分隔）']].map(([key, label]) => h('label', { key }, label, h('input', { value: editor.statusText[key], onChange: e => setEditor(old => ({ ...old, statusText: { ...old.statusText, [key]: e.target.value } })) }))) : []),
            h('label', null, '请求体 JSON（留空使用默认格式）', h('textarea', { value: body, onChange: e => setBody(e.target.value), placeholder: '{ "model": "{{model}}", "prompt": "{{prompt}}" }' }))),
          h('div', { className: 'media-form-actions' }, h('button', { type: 'button', className: 'media-form-button', disabled: busy, onClick: () => { setEditor(null); setSecret(''); setError('') } }, '取消'), h('button', { type: 'submit', className: 'media-form-button media-form-primary', disabled: busy }, busy ? '保存中…' : '保存'))))
    }
    return {
      inject: ['slots', 'configForms', 'remote', 'remote.credentials'],
      apply(ctx) {
        const form = ctx.configForms.get('tool-media-generation')
        const modelForm = ctx.configForms.get('llm-pi-ai')
        const credentials = ctx.remote.credentials
        ctx.inject(['remote.pluginManager'], child => { updateManager = child.remote.pluginManager; return () => { updateManager = undefined } })
        ctx.remote.$mount({ package: 'dsh-media-generation-updater', descriptors: [updateDescriptor] }).then(() => {
          ctx.inject(['remote.deepImageUpdate'], child => { updateRemote = child.remote; return () => { updateRemote = undefined } })
        }, () => { updateRemote = undefined })
        ctx.remote.$mount({ package: 'dsh-media-generation-newapi', descriptors: [newApiDescriptor] }).then(() => {
          ctx.inject(['remote.deepImageNewApi'], child => {
            newApiRemote = child.remote
            return () => { newApiRemote = undefined }
          })
        }, () => { newApiRemote = undefined })
        // The current Harness settings shell chooses icons by its own hard-coded
        // section IDs. Mark this plugin's row until the shell exposes an icon slot.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = `[data-deepimage-settings-nav] > svg{display:none}
            [data-deepimage-settings-nav]::before{content:'';flex:none;width:16px;height:16px;background:currentColor;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m14.5 6.5 3-3a2.12 2.12 0 0 1 3 3l-9 9-3.5.5.5-3.5 6-6Z'/%3E%3Cpath d='M8.5 14.5c-2.5 0-3 1.5-3 3 0 1-.6 1.7-1.5 2 2.5 1 6 .5 6-2.5'/%3E%3C/svg%3E") center / contain no-repeat}`
          document.head.appendChild(style)
          const markRow = () => {
            for (const button of document.querySelectorAll('[data-shortcut-modal="settings"] nav button')) {
              if (button.lastElementChild?.textContent === 'deepImage') button.setAttribute('data-deepimage-settings-nav', '')
            }
          }
          const observer = new MutationObserver(markRow)
          observer.observe(document.body, { childList: true, subtree: true })
          markRow()
          return () => {
            observer.disconnect()
            document.querySelectorAll('[data-deepimage-settings-nav]').forEach(button => button.removeAttribute('data-deepimage-settings-nav'))
            style.remove()
          }
        })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'media-generation', order: 15,
          label: () => 'deepImage', inject: () => ({ form, credentials, modelForm }),
        }, MediaSettings))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'deepimage-newapi-session',
          inject: () => ({ form, credentials, modelForm }),
        }, NewApiSessionMonitor))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview', key: 'generate_image',
        }, ImageToolView))
        ctx.inject(['uiConversation'], child => {
          child.slots.inject('conversation.chat.turnTail', () => child.slots.register({
            name: 'conversation.chat.turnTail', id: 'deepimage-generated-images',
            inject: () => ({ uiConversation: child.uiConversation }),
          }, TurnGeneratedImages))
        })
      },
    }
  },
})
