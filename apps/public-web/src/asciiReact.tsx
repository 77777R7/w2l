import { createRoot } from 'react-dom/client'
import ASCIIText from './reactbits/ASCIIText.jsx'

/** React Bits stays isolated from the plain TypeScript preview UI. */
export function mountReactBitsAscii(container: HTMLElement): () => void {
  const root = createRoot(container)
  root.render(<ASCIIText text="hello_world" enableWaves={true} asciiFontSize={16} />)
  return () => root.unmount()
}
