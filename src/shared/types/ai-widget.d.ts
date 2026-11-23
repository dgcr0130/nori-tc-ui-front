import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'nori-ai-widget': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        position?: 'bottom-right' | 'bottom-left'
      }
    }
  }
}
