const assert = require('node:assert/strict')

;(async () => {
  const { apply } = await import('../src/index.js')
  const registered = new Map()
  let guidance
  const tools = {
    register: tool => registered.set(tool.name, tool),
    get(name, scope) {
      if (scope === 'restricted') return undefined
      if (scope === 'overridden') return { name }
      return registered.get(name)
    },
  }
  const ctx = {
    tools,
    inject(dependencies, callback) {
      if (dependencies.includes('systemPrompt')) callback({ tools, systemPrompt: { section(value) { guidance = value } } })
    },
  }
  apply(ctx, {})
  assert.ok(registered.get('generate_image'))
  assert.ok(guidance)
  const text = guidance.text({ scope: 'native-or-ptc' })
  assert.match(text, /generate_image/)
  assert.match(text, /SVG, vector graphics, diagrams, or code-based drawing/)
  assert.match(text, /PTC mode/)
  assert.match(text, /unavailable or fails/)
  assert.equal(guidance.text({ scope: 'restricted' }), '')
  assert.equal(guidance.text({ scope: 'overridden' }), '')
  console.log('Image tool guidance checks passed: available, restricted, overridden and PTC scopes.')
})().catch(error => { console.error(error); process.exitCode = 1 })
