const GLYPHS = ['·', '+', 'x', '<', '>', '/'] as const

type Particle = { x: number; y: number; dx: number; dy: number; glyph: string; tone: number }

/** The canvas is decorative, pointer-transparent, and confined to the Hero. */
export function mountHeroAscii(canvas: HTMLCanvasElement, hero: HTMLElement): void {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = window.matchMedia('(pointer: fine)')
  const compact = window.matchMedia('(max-width: 600px)')
  if (motion.matches || !pointer.matches || compact.matches) return

  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return

  let particles: Particle[] = []
  let frame = 0
  let visible = true
  let hovering = false
  let pointerX = -1000
  let pointerY = -1000
  let lastFrame = 0
  let slowFrames = 0
  let disabledForPerformance = false
  const maxParticles = 210

  const draw = (): void => {
    const width = hero.clientWidth
    const height = hero.clientHeight
    ctx.clearRect(0, 0, width, height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace'
    for (const particle of particles) {
      const x = particle.x + particle.dx
      const y = particle.y + particle.dy
      const proximity = Math.max(0, 1 - Math.hypot(particle.x - pointerX, particle.y - pointerY) / 145)
      const alpha = 0.12 + proximity * 0.26
      ctx.fillStyle = particle.tone > 0.88
        ? `rgba(255, 156, 111, ${alpha})`
        : `rgba(170, 213, 255, ${alpha})`
      ctx.fillText(particle.glyph, x, y)
    }
  }

  const animate = (time: number): void => {
    if (!visible || motion.matches || !pointer.matches || compact.matches || disabledForPerformance) {
      frame = 0
      return
    }
    // Decorative motion yields permanently on a device that cannot sustain
    // a readable frame cadence. The static mountain remains visible.
    if (lastFrame && document.visibilityState === 'visible') {
      slowFrames = time - lastFrame > 65 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
      if (slowFrames >= 8) {
        disabledForPerformance = true
        frame = 0
        ctx.clearRect(0, 0, hero.clientWidth, hero.clientHeight)
        return
      }
    }
    // Cap decorative work around 45 fps; the image and interface remain static.
    if (time - lastFrame < 22) {
      frame = requestAnimationFrame(animate)
      return
    }
    lastFrame = time
    let unsettled = false
    for (const particle of particles) {
      const vx = particle.x - pointerX
      const vy = particle.y - pointerY
      const distance = Math.hypot(vx, vy)
      const strength = hovering ? Math.max(0, 1 - distance / 145) ** 2 : 0
      const targetDx = distance > 0 ? (vx / distance) * strength * 15 : 0
      const targetDy = distance > 0 ? (vy / distance) * strength * 15 : 0
      particle.dx += (targetDx - particle.dx) * 0.18
      particle.dy += (targetDy - particle.dy) * 0.18
      if (Math.abs(targetDx - particle.dx) + Math.abs(targetDy - particle.dy) > 0.12) unsettled = true
    }
    draw()
    frame = hovering || unsettled ? requestAnimationFrame(animate) : 0
  }

  const start = (): void => {
    if (visible && !frame && !motion.matches && pointer.matches && !compact.matches && !disabledForPerformance) {
      lastFrame = 0
      slowFrames = 0
      frame = requestAnimationFrame(animate)
    }
  }

  const resize = (): void => {
    const width = hero.clientWidth
    const height = hero.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const columns = Math.max(10, Math.ceil(width / 46))
    const rows = Math.max(5, Math.ceil(height / 53))
    const total = columns * rows
    const stride = Math.max(1, Math.ceil(total / maxParticles))
    particles = []
    for (let i = 0; i < total; i += stride) {
      const column = i % columns
      const row = Math.floor(i / columns)
      const seed = (i * 37 + 13) % 97
      particles.push({
        x: (column + 0.25 + (seed % 7) / 14) * width / columns,
        y: (row + 0.22 + (seed % 5) / 12) * height / rows,
        dx: 0,
        dy: 0,
        glyph: GLYPHS[seed % GLYPHS.length],
        tone: seed / 97,
      })
    }
    if (compact.matches) ctx.clearRect(0, 0, width, height)
    else draw()
  }

  hero.addEventListener('pointermove', (event) => {
    const bounds = hero.getBoundingClientRect()
    pointerX = event.clientX - bounds.left
    pointerY = event.clientY - bounds.top
    hovering = true
    start()
  }, { passive: true })
  hero.addEventListener('pointerleave', () => {
    hovering = false
    pointerX = -1000
    pointerY = -1000
    start()
  })

  const observer = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false
    if (visible) start()
    else if (frame) { cancelAnimationFrame(frame); frame = 0 }
  })
  observer.observe(hero)
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(hero)
  motion.addEventListener('change', () => {
    if (motion.matches) {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      ctx.clearRect(0, 0, hero.clientWidth, hero.clientHeight)
    } else resize()
  })
  compact.addEventListener('change', () => {
    if (compact.matches && frame) { cancelAnimationFrame(frame); frame = 0 }
    resize()
  })
  resize()
}
