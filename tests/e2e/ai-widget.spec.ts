import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { widgetBytes, widgetSha256 } from './ai-widget-asset'
import { createHash } from 'node:crypto'

test.use({ locale: 'ko-KR' })

interface CspViolation { directive: string; blockedURI: string; sourceFile: string }

test('운영 CSP 아래 로그인 전후 태그 하나와 쿠키 연결을 유지한다', async ({ page, context }, testInfo) => {
  const nginx = await readFile(resolve('deploy/docker/nginx.conf'), 'utf8')
  const csp = /add_header Content-Security-Policy "([^"]+)" always;/.exec(nginx)?.[1]
  if (!csp) throw new Error('운영 CSP를 찾을 수 없습니다.')
  const root = resolve('dist')
  const errors: string[] = []
  const assetRequests: URL[] = []
  // 개발 서버의 refresh 인라인 스크립트 대신 실제 배포 HTML과 자산에 운영 CSP를 적용한다.
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname
      response.setHeader('Content-Security-Policy', csp)
      if (path === '/api/ai/assets/widget.js') {
        assetRequests.push(url)
        response.setHeader('Content-Type', 'application/javascript')
        response.end(widgetBytes)
        return
      }
      const asset = path.startsWith('/assets/')
      const file = resolve(root, asset ? path.slice(1) : 'index.html')
      if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) throw new Error('시험 자산 경로 오류')
      const types: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' }
      response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
      response.end(await readFile(file))
    })().catch(error => { errors.push(String(error)); response.writeHead(500); response.end() })
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('시험 주소 오류')
    const origin = `http://127.0.0.1:${address.port}`
    await context.addCookies([{ name: 'TC_UI_AUTH', value: 'fake-test-cookie', url: origin }])
    await page.addInitScript(() => {
      const observation = { definitions: 0, violations: [] as CspViolation[], fetches: [] as { path: string; credentials: string | undefined; authorization: string | null }[] }
      Reflect.set(window, 'aiObservation', observation)
      document.addEventListener('securitypolicyviolation', event => observation.violations.push({
        directive: event.violatedDirective, blockedURI: event.blockedURI, sourceFile: event.sourceFile,
      }))
      const define = customElements.define.bind(customElements)
      customElements.define = (name, constructor, options) => { if (name === 'nori-ai-widget') observation.definitions++; define(name, constructor, options) }
      const original = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
        if (path.startsWith('/api/ai/')) observation.fetches.push({ path, credentials: init?.credentials, authorization: new Headers(init?.headers).get('Authorization') })
        return original(input, init)
      }
    })
    let loggedIn = false
    let logoutFails = false, expired = false, holdSession = false, sessionHeld = false
    let releaseSession = () => {}
    const pendingSession = new Promise<void>(resolve => { releaseSession = resolve })
    const sessionRequests: string[] = []
    const success = (data: unknown) => ({ success: true, data, errorCode: null, errorMsg: null })
    await context.route(url => url.pathname.startsWith('/api/') && url.pathname !== '/api/ai/assets/widget.js', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const json = (status: number, data: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (path === '/api/ai/session') {
        expect(request.headers().authorization).toBeUndefined()
        expect(request.headers().cookie).toContain('TC_UI_AUTH=fake-test-cookie')
        sessionRequests.push(path)
        if (holdSession) {
          holdSession = false; sessionHeld = true
          await pendingSession
          return json(200, { subject: '1', canReview: true, integrationVersion: '1.0.3', csrf: { headerName: 'X-Nori-AI-CSRF', token: 'old-session' } })
        }
        return loggedIn ? json(200, { subject: '1', canReview: false, integrationVersion: '1.0.0', csrf: { headerName: 'X-Nori-AI-CSRF', token: 'test-csrf' } })
          : json(401, { code: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.', requestId: 'test-request' })
      }
      if (path === '/api/ai/v1/conversations') return json(200, { items: [], nextAfter: null })
      if (path === '/api/auth/csrf') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'set-cookie': 'XSRF-TOKEN=test-csrf; Path=/' }, body: JSON.stringify(success(null)) })
      if (path === '/api/auth/login') { loggedIn = true; return json(200, success({ userPk: 1, issuedAt: '2026-11-23T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z' })) }
      if (path === '/api/auth/logout') {
        if (logoutFails) return json(503, { success: false, errorCode: 'UNAVAILABLE' })
        loggedIn = false; return json(200, success(null))
      }
      if (path === '/api/auth/me') return loggedIn ? json(200, success({ userPk: 1, userId: 'tester', permissionCodes: ['DLQ_READ', 'LINE_READ'] })) : json(401, { success: false })
      if (path === '/api/line') return json(200, success([{ lineKey: 1, lineCode: 'A', lineName: 'A' }]))
      if (path.startsWith('/api/dlq/')) return expired ? json(401, { success: false }) : json(200, success([]))
      return json(200, success({ items: [], offset: 0, limit: 50, count: 0 }))
    })
    await page.goto(origin + '/login')
    const widget = page.locator('nori-ai-widget')
    await expect(widget).toHaveCount(1)
    await page.getByRole('button', { name: 'AI 대화 열기', exact: true }).click()
    await expect(widget).toContainText('로그인이 필요합니다.')
    await page.getByRole('button', { name: 'AI 대화 최소화', exact: true }).click()
    await page.locator('#userId').fill('tester')
    await page.locator('#password').fill('password1234')
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(origin + '/dlq')
    await expect(widget).toHaveCount(1)
    await page.getByRole('button', { name: 'AI 대화 열기', exact: true }).click()
    await expect(widget.getByRole('button', { name: '새 대화', exact: true })).toBeEnabled()
    await expect(widget.getByRole('button', { name: '검토', exact: true })).toHaveCount(0)
    await expect(page.locator('a[href*="/ai"]')).toHaveCount(0)
    await widget.getByRole('textbox', { name: '질문', exact: true }).fill('TC 호스트 초안')
    await page.getByRole('button', { name: 'AI 대화 최소화', exact: true }).click()
    await page.getByRole('button', { name: 'AI 대화 열기', exact: true }).click()
    await expect(widget.getByRole('textbox', { name: '질문', exact: true })).toHaveValue('TC 호스트 초안')
    await page.getByRole('button', { name: '다크 모드로 전환', exact: true }).click()
    await expect(widget.locator('.panel')).toHaveCSS('background-color', 'rgb(25, 28, 33)')
    await page.screenshot({ path: testInfo.outputPath('implemented-tc-dark.png') })
    await page.getByRole('button', { name: '라이트 모드로 전환', exact: true }).click()
    await expect(widget.locator('.panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.addStyleTag({ content: 'button { border: 19px solid magenta !important; font-size: 57px !important; }' })
    expect(await widget.evaluate(element => {
      const button = element.shadowRoot?.querySelector('button')
      return { shadow: !!element.shadowRoot, headers: Reflect.get(element, 'requestHeaders') === undefined,
        border: button ? getComputedStyle(button).borderTopWidth : null, font: button ? getComputedStyle(button).fontSize : null }
    })).toEqual({ shadow: true, headers: true, border: '1px', font: '14px' })
    const fontFamily = await widget.evaluate(element => getComputedStyle(element.shadowRoot!.querySelector('header button')!).fontFamily)
    expect(fontFamily.split(',')[0]?.replaceAll('"', '').trim()).toBe('Pretendard Variable')
    const observation = await page.evaluate(() => Reflect.get(window, 'aiObservation') as { definitions: number; violations: CspViolation[]; fetches: { credentials: string; authorization: string | null }[] })
    expect(observation.definitions).toBe(1)
    expect(observation.violations.filter(violation => (violation.sourceFile.startsWith(origin + '/')
      && new URL(violation.sourceFile).pathname === '/api/ai/assets/widget.js')
      || violation.directive.startsWith('style-src'))).toEqual([])
    expect(observation.violations.filter(violation => {
      // 기존 zod의 eval 지원 검사만 허용하며 위젯·스타일·다른 CSP 위반은 계속 실패시킨다.
      return !(violation.directive === 'script-src' && violation.blockedURI === 'eval'
        && violation.sourceFile.startsWith(origin + '/assets/form-vendor-')
        && /^\/assets\/form-vendor-[^/]+\.js$/.test(new URL(violation.sourceFile).pathname))
    })).toEqual([])
    expect(observation.fetches.length).toBeGreaterThan(1)
    expect(observation.fetches.every(request => request.credentials === 'same-origin' && request.authorization === null)).toBe(true)
    expect(sessionRequests.length).toBeGreaterThanOrEqual(2)
    expect(assetRequests).toHaveLength(1)
    expect(assetRequests[0].pathname).toBe('/api/ai/assets/widget.js')
    expect([...assetRequests[0].searchParams.entries()]).toEqual([['v', '1.0.4']])
    expect(createHash('sha256').update(widgetBytes).digest('hex')).toBe(widgetSha256)
    expect(errors).toEqual([])
    // 같은 origin의 두 실제 SPA에서 최소화 중 통지와 서버 로그아웃 실패를 함께 확인한다.
    const other = await context.newPage()
    try {
      await other.goto(origin + '/dlq')
      const otherWidget = other.locator('nori-ai-widget')
      await other.getByRole('button', { name: 'AI 대화 열기', exact: true }).click()
      await otherWidget.getByRole('textbox', { name: '질문', exact: true }).fill('다른 탭의 이전 초안')
      await other.getByRole('button', { name: 'AI 대화 최소화', exact: true }).click()
      holdSession = true
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect.poll(() => sessionHeld).toBe(true)
      logoutFails = true
      await page.getByRole('button', { name: '로그아웃', exact: true }).click()
      await expect(page).toHaveURL(origin + '/login')
      releaseSession()
      await expect(widget.getByRole('textbox', { name: '질문', exact: true })).toHaveCount(0)
      await expect.poll(() => otherWidget.evaluate(element => element.shadowRoot?.querySelector('textarea') === null)).toBe(true)
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(widget.getByRole('textbox', { name: '질문', exact: true })).toHaveCount(0)
      await page.locator('#userId').fill('tester'); await page.locator('#password').fill('password1234')
      await page.locator('button[type="submit"]').click()
      await expect(page).toHaveURL(origin + '/dlq')
      await expect(widget.getByRole('textbox', { name: '질문', exact: true })).toHaveValue('')
      await other.getByRole('button', { name: 'AI 대화 열기', exact: true }).click()
      await expect(otherWidget.getByRole('textbox', { name: '질문', exact: true })).toHaveValue('')
      logoutFails = false
      await page.getByRole('button', { name: '로그아웃', exact: true }).click()
      await expect(page).toHaveURL(origin + '/login')
      await expect(otherWidget.getByRole('textbox', { name: '질문', exact: true })).toHaveCount(0)
      await page.locator('#userId').fill('tester'); await page.locator('#password').fill('password1234')
      await page.locator('button[type="submit"]').click()
      await expect(page).toHaveURL(origin + '/dlq')
      await page.getByRole('button', { name: 'AI 대화 최소화', exact: true }).click()
      expired = true; loggedIn = false
      await page.getByTestId('dlq-dashboard-refresh').click()
      await expect(page).toHaveURL(origin + '/login')
      await page.getByRole('button', { name: 'AI 대화 열기', exact: true }).click()
      await expect(page.locator('nori-ai-widget')).toContainText('로그인이 필요합니다.')
    } finally { releaseSession(); await other.close() }
  } finally {
    await page.close()
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
  }
})
