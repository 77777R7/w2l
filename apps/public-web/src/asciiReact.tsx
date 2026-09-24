import { createRoot } from 'react-dom/client'
import ASCIIText from './reactbits/ASCIIText.jsx'

/** React Bits stays isolated from the plain TypeScript preview UI. */
export function mountReactBitsAscii(container: HTMLElement): () => void {
  const root = createRoot(container)
  root.render(
    <>
      <div className="hero-ascii-wing hero-ascii-wing-left">
        <ASCIIText text="hello_world" enableWaves={true} asciiFontSize={16} planeBaseHeight={16} />
      </div>
      <div className="hero-ascii-wing hero-ascii-wing-right">
        <ASCIIText text="hello_world" enableWaves={true} asciiFontSize={16} planeBaseHeight={16} />
      </div>
    </>
  )
  return () => root.unmount()
}
