import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 1.0.4 로컬 Maven starter jar의 META-INF/ai-integration/widget.js와 동등성을 확인한 SHA-256이다.
// 배포 자산을 복사하지 않고 공통 빌드 출력을 읽으며 바이트가 다르면 시험을 중단한다.
export const widgetBytes = readFileSync(resolve(process.cwd(), '../nori-ai-integration/front/dist/widget.js'))
export const widgetSha256 = '897b31cbb54d0397573f157ac2c0cb1efdd11c00d941b987d65f18678da4fec3'
if (createHash('sha256').update(widgetBytes).digest('hex') !== widgetSha256) {
  throw new Error('위젯 빌드 출력과 인증 회귀시험 자산의 SHA-256이 다릅니다.')
}
export const widgetResponse = { status: 200, contentType: 'application/javascript', body: widgetBytes }
