/** Load the decorative React Bits renderer only on desktop pointer devices. */
export function mountHeroAscii(container: HTMLElement, hero: HTMLElement): void {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = window.matchMedia('(pointer: fine)')
  const compact = window.matchMedia('(max-width: 600px)')
  let dispose: (() => void) | null = null
  let generation = 0
  let loading = false
  let visible = true

  const eligible = (): boolean => visible && !motion.matches && pointer.matches && !compact.matches
  const reconcile = (): void => {
    if (!eligible()) {
      generation++
      dispose?.()
      dispose = null
      return
    }
    if (dispose || loading) return
    loading = true
    const version = ++generation
    void import('./asciiReact').then(({ mountReactBitsAscii }) => {
      loading = false
      if (version === generation && eligible()) dispose = mountReactBitsAscii(container)
      else if (eligible()) reconcile()
    }).catch(() => { loading = false }) // The page remains usable without decoration.
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting)
    reconcile()
  }, { threshold: 0.05 })
  observer.observe(hero)
  for (const query of [motion, pointer, compact]) query.addEventListener('change', reconcile)
  reconcile()
}
