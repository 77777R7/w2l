import { createRoot } from 'react-dom/client'
import ClickSpark from './reactbits/ClickSpark.jsx'

/** Mount React Bits over the existing plain TypeScript Hero without wrapping its controls. */
export function mountReactBitsClickSpark(container: HTMLElement, hero: HTMLElement): () => void {
  const root = createRoot(container)
  root.render(
    <ClickSpark
      target={hero}
      sparkColor="#ffffff"
      sparkSize={30}
      sparkRadius={15}
      sparkCount={8}
      duration={400}
      extraScale={1}
    />
  )
  return () => root.unmount()
}
