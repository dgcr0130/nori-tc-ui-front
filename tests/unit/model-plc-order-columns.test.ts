import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { transpileModule, JsxEmit, ModuleKind } from 'typescript'
import { Children, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// 기존 node:test 환경에서 실제 TSX 셀을 실행한다. 파일 산출물과 별도 브라우저는 만들지 않는다.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    return {
      format: 'module',
      shortCircuit: true,
      source: transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext },
        fileName: new URL(url).pathname,
      }).outputText,
    }
  },
})

const { createPlcColumns } = await import('@/features/model/components/modelDetailColumnDefs.tsx')
const { Select, SelectItem, SELECT_EMPTY_VALUE } = await import('@/components/ui/select.tsx')

type CellProps = {
  value: string
  children?: ReactNode
  onValueChange: (value: string) => void
}

const optionValues = (node: ReactNode): string[] => Children.toArray(node).flatMap((child) => {
  if (!isValidElement<CellProps>(child)) return []
  return child.type === SelectItem ? [child.props.value] : optionValues(child.props.children)
})

for (const [columnName, columnIndex] of [['Byte Order', 7], ['Word Order', 8]] as const) {
  test(`${columnName}는 기본값과 두 엔디안 목록을 렌더하고 변경을 전달합니다`, () => {
    const changes: Array<[string, number, string]> = []
    const columns = createPlcColumns({
      visibleColumns: [{ columnName, columnIndex }],
      detailColumnWidths: [], isReadOnly: false, groupOptions: [],
      onChangeDetailValue: (...args) => { changes.push(args) },
    })
    for (const value of ['', 'BIG_ENDIAN', 'LITTLE_ENDIAN', 'LEGACY_ORDER']) {
      const values: string[] = []
      values[columnIndex] = value
      const cell = columns[0].renderCell!(
        { id: 'register-42', values, previewValues: [] }, 0, 0,
        { isEditing: true, beginEdit: () => {}, endEdit: () => {} },
      )
      assert.ok(isValidElement<CellProps>(cell))
      assert.equal(cell.type, Select)
      assert.equal(cell.props.value, value || SELECT_EMPTY_VALUE)
      assert.deepEqual(optionValues(cell), [
        SELECT_EMPTY_VALUE, ...(value === 'LEGACY_ORDER' ? [value] : []), 'BIG_ENDIAN', 'LITTLE_ENDIAN',
      ])
      assert.match(renderToStaticMarkup(cell), /role="combobox"/)
      for (const next of ['BIG_ENDIAN', 'LITTLE_ENDIAN', SELECT_EMPTY_VALUE]) {
        cell.props.onValueChange(next)
        assert.deepEqual(changes.at(-1), ['register-42', columnIndex, next === SELECT_EMPTY_VALUE ? '' : next])
      }
    }
  })

  test(`${columnName} 읽기 전용은 저장값과 빈값 표시를 유지합니다`, () => {
    const columns = createPlcColumns({
      visibleColumns: [{ columnName, columnIndex }],
      detailColumnWidths: [], isReadOnly: true, groupOptions: [],
      onChangeDetailValue: () => { assert.fail('읽기 전용 값 변경') },
    })
    for (const value of ['', 'LITTLE_ENDIAN', 'LEGACY_ORDER']) {
      const values: string[] = []
      values[columnIndex] = value
      const cell = columns[0].renderCell!(
        { id: 'register-42', values, previewValues: [] }, 0, 0,
        { isEditing: false, beginEdit: () => {}, endEdit: () => {} },
      )
      assert.match(renderToStaticMarkup(cell), new RegExp(value || '—'))
    }
  })
}
