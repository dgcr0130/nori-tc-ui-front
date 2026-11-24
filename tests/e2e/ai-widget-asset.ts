import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 1.0.2 로컬 Maven jar의 META-INF/ai-integration/widget.js와 대조한 SHA-256이다.
// 배포 자산을 복사하지 않고 공통 빌드 출력을 읽으며 바이트가 다르면 시험을 중단한다.
export const widgetBytes = readFileSync(resolve(process.cwd(), '../nori-ai-integration/front/dist/widget.js'))
export const widgetSha256 = '617aadc55c1cf4ca1cde8c9dcb9432250d0b54c5a5118965973dae0eb7925bc3'
if (createHash('sha256').update(widgetBytes).digest('hex') !== widgetSha256) {
  throw new Error('위젯 빌드 출력과 검증한 공통 jar 자산의 SHA-256이 다릅니다.')
}
export const widgetResponse = { status: 200, contentType: 'application/javascript', body: widgetBytes }
