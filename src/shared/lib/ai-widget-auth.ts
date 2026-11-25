type AuthState = 'signed-out' | 'invalidate' | 'check'
interface AuthHint { version: 1; sender: string; revision: number; state: 'signed-out' | 'check' }

export function authHint(value: unknown): AuthHint | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (row.version !== 1 || typeof row.sender !== 'string' || row.sender.length === 0 || row.sender.length > 128
    || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1
    || (row.state !== 'signed-out' && row.state !== 'check')) return null
  return { version: 1, sender: row.sender, revision: row.revision as number, state: row.state }
}

const sender = crypto.randomUUID()
let revision = 0
let localSignedOut = false
const received = new Map<string, number>()
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('nori-ai-auth') : null

function apply(state: AuthState): void {
  if (typeof window === 'undefined') return
  // 이벤트보다 먼저 남겨 지연 로딩된 위젯도 로그아웃 상태를 읽게 한다. 신원/토큰은 전달하지 않는다.
  Reflect.set(window, 'noriAiAuthState', state)
  window.dispatchEvent(new Event('nori-ai-auth-change'))
}

if (channel) channel.onmessage = event => {
  const hint = authHint(event.data)
  if (!hint || hint.sender === sender || hint.revision <= (received.get(hint.sender) ?? 0)) return
  received.set(hint.sender, hint.revision)
  // 다른 탭의 통지는 캐시를 즉시 회수하는 힌트다. 다음 focus에서도 서버 확인을 유지한다.
  apply(localSignedOut ? 'signed-out' : hint.state === 'signed-out' ? 'invalidate' : 'check')
}

export function notifyAiAuth(state: 'signed-out' | 'check'): void {
  localSignedOut = state === 'signed-out'
  apply(state)
  channel?.postMessage({ version: 1, sender, revision: ++revision, state } satisfies AuthHint)
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', event => {
  if (!event.persisted) channel?.close()
})
