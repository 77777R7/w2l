import { createRoot } from 'react-dom/client'
import ASCIIText from './reactbits/ASCIIText.jsx'

/** React Bits stays isolated from the plain TypeScript preview UI. */
export function mountReactBitsAscii(container: HTMLElement): () => void {
  const root = createRoot(container)
  root.render(
    <div className="hero-ascii-layer hero-ascii-octopus">
      <ASCIIText text="octopus" enableWaves={true} asciiFontSize={14} fieldMode={true} fieldVariant={5} motifMode={true} />
    </div>
  )
  return () => root.unmount()
}
