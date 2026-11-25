import assert from 'node:assert/strict'
import test from 'node:test'

test('인증 통지는 동기 무효화·payload 검증·중복/역순 억제이며 신원을 전달하지 않는다', async () => {
  const originalWindow = Reflect.get(globalThis, 'window')
  const OriginalChannel = globalThis.BroadcastChannel
  const target = new EventTarget()
  const sent: unknown[] = []
  let receiver: ((event: { data: unknown }) => void) | null = null
  class TestChannel {
    set onmessage(value: (event: { data: unknown }) => void) { receiver = value }
    postMessage(value: unknown) { sent.push(value) }
    close() {}
  }
  Reflect.set(globalThis, 'window', target)
  Reflect.set(globalThis, 'BroadcastChannel', TestChannel)
  try {
    const { notifyAiAuth, authHint } = await import('@/shared/lib/ai-widget-auth.ts')
    const states: unknown[] = []
    target.addEventListener('nori-ai-auth-change', () => states.push(Reflect.get(target, 'noriAiAuthState')))
    notifyAiAuth('signed-out')
    assert.deepEqual(states, ['signed-out'])
    const hint = authHint(sent[0])
    assert.ok(hint)
    assert.deepEqual(Object.keys(hint).sort(), ['revision', 'sender', 'state', 'version'])
    assert.equal(authHint({ ...hint, revision: -1 }), null)
    assert.equal(authHint({ ...hint, state: 'authenticated' }), null)
    assert.equal(authHint({ ...hint, sender: '' }), null)
    notifyAiAuth('check')
    const deliver = (data: unknown) => {
      if (!receiver) throw new Error('수신 연결 누락')
      receiver({ data })
    }
    deliver({ version: 1, sender: 'other-tab', revision: 2, state: 'signed-out' })
    deliver({ version: 1, sender: 'other-tab', revision: 2, state: 'check' })
    deliver({ version: 1, sender: 'other-tab', revision: 1, state: 'check' })
    deliver({ version: 1, sender: 'other-tab', revision: 3, state: 'authenticated' })
    assert.deepEqual(states, ['signed-out', 'check', 'invalidate'])
    deliver({ version: 1, sender: 'other-tab', revision: 4, state: 'check' })
    assert.deepEqual(states, ['signed-out', 'check', 'invalidate', 'check'])
    assert.equal(authHint(sent[1])?.revision, hint.revision + 1)
    notifyAiAuth('signed-out')
    deliver({ version: 1, sender: 'other-tab', revision: 5, state: 'check' })
    assert.equal(states.at(-1), 'signed-out')
  } finally {
    Reflect.set(globalThis, 'BroadcastChannel', OriginalChannel)
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
    else Reflect.set(globalThis, 'window', originalWindow)
  }
})
