const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require('node:path').join(__dirname, '../client.js'), 'utf8')
const start = source.indexOf('    function generatedImages(')
const end = source.indexOf('    function TurnGeneratedImages(', start)
assert.ok(start >= 0 && end > start)
const context = {}
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.generatedImages = generatedImages', context)
const attachment = { attachmentId: 'image-1' }
const result = (callId, content, extra = {}) => ({ kind: 'tool-result', name: 'generate_image', callId, content, ...extra })
const calls = [
  { root: result('first', [{ type: 'image', attachment }, { type: 'text', text: 'Image URL: https://example.com/duplicate.png' }]) },
  { root: result('second', [{ type: 'text', text: 'Image URL: https://example.com/generated.png' }]) },
  { root: result('failure', [{ type: 'image', attachment }], { isError: true }) },
  { root: { kind: 'tool-result', name: 'other', subCalls: [result('nested', [{ type: 'image', attachment }])] } },
  { root: result('invalid', [{ type: 'text', text: 'Image URL: javascript:alert(1)' }]) },
  { root: result('history', [{ type: 'text', text: 'Image generated with example and stored as a durable DSH attachment.' }, { type: 'image', attachment }], { name: '' }) },
  { root: result('unrelated', [{ type: 'image', attachment }], { name: '' }) },
]
const images = context.generatedImages(calls)
assert.equal(images.length, 4)
assert.equal(images[0].attachment, attachment)
assert.equal(images[1].url, 'https://example.com/generated.png')
assert.equal(images[2].key, 'nested:image-1')
assert.equal(images[3].key, 'history:image-1')

// Exercise both render paths together: successful results belong in the turn,
// while tool details keep text and errors without rendering the same image.
const componentsStart = source.indexOf('    function GeneratedImage(')
const componentsEnd = source.indexOf('    function MediaSettings(', componentsStart)
const React = {
  Fragment: 'fragment',
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect() {},
  useMemo: fn => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
const h = (type, props, ...children) => ({ type, props: props || {}, children })
const ui = { React, h, Date, Math, Array, JSON, setInterval, clearInterval }
vm.runInNewContext(source.slice(componentsStart, componentsEnd) + '\nglobalThis.TurnGeneratedImages = TurnGeneratedImages; globalThis.ImageToolView = ImageToolView', ui)
const loader = Object.assign(() => Promise.resolve('https://example.com/image.png'), { peek: () => 'https://example.com/image.png' })
const conversation = { imageUrl: () => loader(), peekImageUrl: () => loader.peek() }
function flatten(node) {
  if (node == null || typeof node !== 'object') return []
  if (typeof node.type === 'function') return flatten(node.type({ ...node.props, children: node.children }))
  return [node, ...(node.children || []).flatMap(flatten)]
}
const content = [{ type: 'text', text: '图片已生成' }, { type: 'image', attachment }]
const tool = ui.ImageToolView({ phase: 'result', block: result('one', content), loadImage: loader, inspect() {} })
const turn = ui.TurnGeneratedImages({ turn: { turn: 1 }, sessionId: 'session', useChat: selector => selector({ nodes: { turnDataSource: () => ({ subscribe() {}, getSnapshot: () => [{ root: result('one', content) }] }) } }), uiConversation: conversation })
assert.equal(flatten(tool).filter(node => node.type === 'img').length, 0)
assert.equal(flatten(turn).filter(node => node.type === 'img').length, 1)
assert.ok(flatten(tool).some(node => node.type === 'button' && node.children.includes('查看工具详情')))
const error = ui.ImageToolView({ phase: 'result', block: result('bad', [{ type: 'text', text: '请求失败' }], { isError: true }), loadImage: loader })
assert.ok(flatten(error).some(node => node.type === 'strong' && node.children.includes('图片生成失败')))
assert.ok(flatten(error).some(node => node.type === 'p' && node.children.includes('请求失败')))
const loading = ui.ImageToolView({ phase: 'start', block: { callId: 'running', time: Date.now() }, loadImage: loader })
assert.ok(flatten(loading).some(node => node.props.role === 'status'))
const urlContent = [{ type: 'text', text: 'Image URL: https://example.com/generated.png' }]
const urlTool = ui.ImageToolView({ phase: 'result', block: result('url', urlContent), loadImage: loader })
const urlTurn = ui.TurnGeneratedImages({ turn: { turn: 1 }, sessionId: 'session', useChat: selector => selector({ nodes: { turnDataSource: () => ({ subscribe() {}, getSnapshot: () => [{ root: result('url', urlContent) }] }) } }), uiConversation: conversation })
assert.equal(flatten(urlTool).filter(node => node.type === 'img').length, 0)
assert.equal(flatten(urlTurn).filter(node => node.type === 'img').length, 1)
const multi = ui.TurnGeneratedImages({ turn: { turn: 1 }, sessionId: 'session', useChat: selector => selector({ nodes: { turnDataSource: () => ({ subscribe() {}, getSnapshot: () => [{ root: result('multiple', [{ type: 'image', attachment }, { type: 'image', attachment: { attachmentId: 'image-2' } }]) }] }) } }), uiConversation: conversation })
assert.equal(flatten(multi).filter(node => node.type === 'img').length, 2)
console.log('Image preview checks passed: a single preview, multiple images, loading, errors, URLs and nested calls.')
