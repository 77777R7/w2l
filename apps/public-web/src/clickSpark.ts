/** Load click decoration only for mouse/trackpad users who allow motion. */
export function mountHeroClickSpark(container: HTMLElement, hero: HTMLElement): void {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = window.matchMedia('(pointer: fine)')
  const compact = window.matchMedia('(max-width: 600px)')
  let dispose: (() => void) | null = null
  let generation = 0
  let loading = false

  const eligible = (): boolean => !motion.matches && pointer.matches && !compact.matches
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
    void import('./clickSparkReact').then(({ mountReactBitsClickSpark }) => {
      loading = false
      if (version === generation && eligible()) dispose = mountReactBitsClickSpark(container, hero)
      else if (eligible()) reconcile()
    }).catch(() => { loading = false }) // Decoration must never prevent preview use.
  }

  motion.addEventListener('change', reconcile)
  pointer.addEventListener('change', reconcile)
  compact.addEventListener('change', reconcile)
  reconcile()
}
