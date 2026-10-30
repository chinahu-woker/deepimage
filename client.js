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

    function MediaSettings({ form, credentials }) {
      const snapshot = React.useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form), form.getSnapshot.bind(form))
      const [editor, setEditor] = React.useState(null)
      const [secret, setSecret] = React.useState('')
      const [body, setBody] = React.useState('')
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [openMenu, setOpenMenu] = React.useState(null)
      const [activeKind, setActiveKind] = React.useState('image')
      const [timeoutDraft, setTimeoutDraft] = React.useState(null)
      const [timeoutBusy, setTimeoutBusy] = React.useState(false)
      const value = snapshot.value || {}
      const timeoutValue = timeoutDraft ?? String(Math.round((Number(value.timeoutMs) || 60000) / 1000))
      const saveTimeout = async () => {
        const seconds = Number(timeoutValue)
        if (!Number.isFinite(seconds) || seconds < 1) { setError('超时时间需要是不小于 1 的秒数。'); return }
        setTimeoutBusy(true); setError('')
        try {
          const ok = await form.mutate([{ op: 'set', path: ['timeoutMs'], value: Math.round(seconds * 1000) }], snapshot.revision)
          if (!ok) throw new Error('超时时间未保存，请刷新后重试。')
          setTimeoutDraft(null)
        } catch (err) { setError(err.message || String(err)) } finally { setTimeoutBusy(false) }
      }
      const open = (kind, provider, index) => {
        setEditor({ kind, index, revision: snapshot.revision, data: { ...defaults(kind), ...(provider || {}) }, statusText: { successStatuses: (provider?.successStatuses ?? ['succeeded', 'completed']).join(', '), failureStatuses: (provider?.failureStatuses ?? ['failed', 'error', 'cancelled', 'expired']).join(', ') } })
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
        const list = value[kind === 'image' ? 'imageProviders' : 'videoProviders'] || []
        return h('section', { className: 'media-section', key: kind },
          h('div', { className: 'media-heading' },
            h('div', null, h('h3', null, title), h('p', { className: 'media-section-description' }, kind === 'image' ? '用于在对话中生成图片' : '用于创建和查询视频任务')),
            h('button', { type: 'button', className: 'media-add', disabled: !snapshot.writable || busy, onClick: () => open(kind, null, null) }, h('span', { 'aria-hidden': true }, '+'), '添加服务商')),
          list.length ? h('div', { className: 'media-card-list' }, list.map((provider, index) => h('article', { className: 'media-card', key: provider.id },
            h('div', { className: 'media-card-top' },
              h('div', { className: 'media-card-identity' }, h('strong', null, provider.id), kind === 'image' && value.defaultImageProvider === provider.id && h('span', { className: 'media-badge' }, '默认')),
              h('div', { className: 'media-card-actions' },
                h('button', { type: 'button', className: 'media-edit', disabled: busy || !snapshot.writable, onClick: () => open(kind, provider, index) }, '编辑'),
                h(Menu, {
                  open: openMenu === `${kind}:${provider.id}`,
                  onClose: () => setOpenMenu(null), align: 'end', portal: true, autoFocus: true,
                  anchor: h('button', { type: 'button', className: 'media-more', disabled: busy || !snapshot.writable, 'aria-label': `${provider.id} 的更多操作`, 'aria-haspopup': 'menu', 'aria-expanded': openMenu === `${kind}:${provider.id}`, onClick: () => setOpenMenu(current => current === `${kind}:${provider.id}` ? null : `${kind}:${provider.id}`) }, '•••'),
                },
                kind === 'image' && value.defaultImageProvider !== provider.id && h(MenuItemButton, { onSelect: () => { setOpenMenu(null); setDefault(provider.id) } }, '设为默认'),
                h(MenuItemButton, { onSelect: () => { setOpenMenu(null); remove(kind, index) } }, '删除服务商')))),
            h('div', { className: 'media-card-meta' },
              h('div', null, h('span', null, '模型'), h('span', { title: provider.model }, provider.model)),
              h('div', null, h('span', null, '凭据引用'), h('span', { title: provider.apiKeyEnv }, provider.apiKeyEnv)))))) : h('div', { className: 'media-empty' }, '暂无服务商，添加后即可使用。'))
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
          .media-global{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-top:20px;padding:14px 16px;border:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-settings-card-fill,#f7f8fa)}
          .media-global strong{font-weight:600}.media-global p{margin:2px 0 0!important;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#858b98);max-width:44ch}
          .media-global-control{display:flex;align-items:center;gap:8px;flex-shrink:0}.media-global-control input{width:96px;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit)}
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
          .media-card-list{display:grid;gap:10px}
          .media-card{position:relative;min-width:0;padding:16px;border:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-settings-card-fill,#f7f8fa)}
          .media-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
          .media-card-identity{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;padding-top:4px}
          .media-card-identity strong{font-weight:600;overflow-wrap:anywhere}
          .media-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;color:var(--dsw-alias-brand-text,#4263d9);background:var(--dsw-alias-interactive-bg-hover-accent,#e8edff);font-size:12px;line-height:20px;font-weight:500}
          .media-card-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
          .media-edit,.media-more{display:inline-flex;align-items:center;justify-content:center;min-height:30px;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent}
          .media-edit{padding:0 9px;color:var(--dsw-alias-label-secondary,#5b6170)!important}
          .media-more{width:32px;letter-spacing:1px}
          .media-card-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.media-card-meta div{display:grid;gap:2px;min-width:0}.media-card-meta span:first-child{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#858b98)}.media-card-meta span:last-child{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#5b6170);overflow-wrap:anywhere}
          .media-empty{padding:20px;border:1px dashed var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-tertiary,#858b98)}
          .media-form{display:grid;gap:16px;margin-top:24px}.media-form h3{font:var(--dsw-font-base-strong-16,600 16px/24px sans-serif)}.media-form label{display:grid;gap:6px;color:var(--dsw-alias-label-secondary,#5b6170)}
          .media-form input:not([type=checkbox]),.media-form textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3,#d9dce3);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit)}.media-form textarea{min-height:100px;font-family:var(--ds-font-family-code,monospace)}
          .media-form details{padding:12px;border:1px solid var(--dsw-alias-settings-card-stroke,#e2e5eb);border-radius:var(--dsw-radius-sm,8px)}.media-form details summary{cursor:pointer}.media-form details label{margin-top:12px}
          .media-form-actions{display:flex;justify-content:flex-end;gap:8px}.media-form-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff)!important;border-color:transparent}.media-form-primary:hover{opacity:.9}
          .media-error{margin-top:16px!important;color:var(--dsw-alias-label-danger,#c44);white-space:pre-wrap}
          @media(max-width:600px){.media-settings{padding:16px}.media-global{align-items:flex-start;flex-direction:column}.media-card-meta{grid-template-columns:1fr;gap:8px}.media-heading{align-items:flex-start}.media-section-description{max-width:28ch}}
        `),
        h('h2', null, 'deepImage'),
        h('p', { className: 'media-intro' }, '管理图片和视频服务商，选择用于自动绘图的默认服务商。'),
        !editor && snapshot.status === 'ready' && h('div', { className: 'media-global' },
          h('div', null,
            h('strong', null, '生成超时'),
            h('p', null, '单次生成请求的等待上限（秒）。图片生成本身耗时较长，或服务商响应较慢时可以调高。')),
          h('div', { className: 'media-global-control' },
            h('input', { type: 'number', min: 1, step: 1, inputMode: 'numeric', value: timeoutValue, disabled: !snapshot.writable || timeoutBusy, onChange: e => setTimeoutDraft(e.target.value) }),
            h('span', null, '秒'),
            h('button', { type: 'button', className: 'media-form-button', disabled: !snapshot.writable || timeoutBusy || timeoutDraft === null, onClick: saveTimeout }, timeoutBusy ? '保存中…' : '保存'))),
        !editor && h('div', { className: 'media-tabs', role: 'tablist', 'aria-label': 'deepImage 页面' },
          ...[['image', '绘图'], ['video', '视频'], ['settings', '设置']].map(([kind, label]) => h('button', {
            key: kind, id: `media-tab-${kind}`, type: 'button', className: 'media-tab', role: 'tab', 'aria-selected': activeKind === kind,
            'aria-controls': kind === 'settings' ? 'media-settings-panel' : 'media-provider-panel', tabIndex: activeKind === kind ? 0 : -1,
            onClick: () => { setOpenMenu(null); setError(''); setActiveKind(kind) },
            onKeyDown: e => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              const kinds = ['image', 'video', 'settings']
              const next = kinds[(kinds.indexOf(kind) + (e.key === 'ArrowRight' ? 1 : -1) + kinds.length) % kinds.length]
              setOpenMenu(null); setError(''); setActiveKind(next)
              e.currentTarget.parentElement.querySelector(`[data-media-kind="${next}"]`)?.focus()
            }, 'data-media-kind': kind,
          }, label))),
        snapshot.status !== 'ready' ? h('p', null, snapshot.status === 'loading' ? '正在加载配置…' : '配置暂不可用。') : !editor && activeKind !== 'settings' && h('div', { id: 'media-provider-panel', role: 'tabpanel', 'aria-labelledby': `media-tab-${activeKind}` }, section(activeKind, activeKind === 'image' ? '绘图服务商' : '视频服务商')),
        snapshot.status === 'ready' && h('div', { id: 'media-settings-panel', role: 'tabpanel', 'aria-labelledby': 'media-tab-settings', hidden: !!editor || activeKind !== 'settings' }, h(UpdatePanel)),
        error && h('p', { className: 'media-error', role: 'alert' }, error),
        editor && h('form', { className: 'media-form', onSubmit: save },
          h('h3', null, `${editor.index === null ? '添加' : '编辑'}${editor.kind === 'image' ? '绘图' : '视频'}服务商`),
          ...fields.slice(0, 4).map(([key, label, required]) => h('label', { key }, label, h('input', { value: editor.data[key] ?? '', required, onChange: e => change(key, e.target.value) }))),
          editor.kind === 'video' && h('label', null, '查询任务地址（包含 {taskId}）', h('input', { required: true, value: editor.data.statusEndpointTemplate ?? '', onChange: e => change('statusEndpointTemplate', e.target.value) })),
          h('label', null, 'API Key（留空使用已有凭据）', h('input', { type: 'password', autoComplete: 'new-password', value: secret, onChange: e => setSecret(e.target.value) })),
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
        const credentials = ctx.remote.credentials
        ctx.inject(['remote.pluginManager'], child => { updateManager = child.remote.pluginManager; return () => { updateManager = undefined } })
        ctx.remote.$mount({ package: 'dsh-media-generation-updater', descriptors: [updateDescriptor] }).then(() => {
          ctx.inject(['remote.deepImageUpdate'], child => { updateRemote = child.remote; return () => { updateRemote = undefined } })
        }, () => { updateRemote = undefined })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'media-generation', order: 15,
          label: () => 'deepImage', inject: () => ({ form, credentials }),
        }, MediaSettings))
      },
    }
  },
})
