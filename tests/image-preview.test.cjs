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
console.log('Image preview checks passed: attachments, URL, nested calls and failed results.')
