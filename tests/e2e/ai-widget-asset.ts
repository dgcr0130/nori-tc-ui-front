import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 1.0.6 SDK 빌드의 최종 바이트를 고정하는 SHA-256이다.
// 배포 자산을 복사하지 않고 공통 빌드 출력을 읽으며 바이트가 다르면 시험을 중단한다.
export const widgetBytes = readFileSync(resolve(process.cwd(), '../nori-ai-integration/front/dist/widget.js'))
export const widgetSha256 = '58254fff8b7bcc20e778592dc7d11423baf754ce212395027664fc21c179ecf9'
if (createHash('sha256').update(widgetBytes).digest('hex') !== widgetSha256) {
  throw new Error('위젯 빌드 출력과 인증 회귀시험 자산의 SHA-256이 다릅니다.')
}
export const widgetResponse = { status: 200, contentType: 'application/javascript', body: widgetBytes }
