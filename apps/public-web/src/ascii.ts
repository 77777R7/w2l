type Patch = { x: number; y: number; rx: number; ry: number; weight: number }
type Mark = { x: number; y: number; size: number; alpha: number; kind: number; phase: number; layer: number; warm: boolean }

// Texture islands follow the mountain artwork instead of spelling readable words.
const patches: Patch[] = [
  { x: .08, y: .18, rx: .19, ry: .20, weight: .8 },
  { x: .24, y: .30, rx: .19, ry: .14, weight: .72 },
  { x: .08, y: .45, rx: .18, ry: .19, weight: .76 },
  { x: .26, y: .55, rx: .17, ry: .15, weight: .7 },
  { x: .10, y: .72, rx: .23, ry: .18, weight: .63 },
  { x: .93, y: .16, rx: .20, ry: .18, weight: .82 },
  { x: .76, y: .29, rx: .18, ry: .14, weight: .67 },
  { x: .93, y: .43, rx: .19, ry: .20, weight: .78 },
  { x: .75, y: .55, rx: .18, ry: .16, weight: .75 },
  { x: .91, y: .73, rx: .22, ry: .18, weight: .63 }
]

function random(seed: number): number {
  const value = Math.sin(seed * 127.1 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function smoothstep(a: number, b: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function patchStrength(x: number, y: number): number {
  let first = 0
  let second = 0
  for (const patch of patches) {
    const dx = (x - patch.x) / patch.rx
    const dy = (y - patch.y) / patch.ry
    const value = Math.pow(Math.max(0, 1 - dx * dx - dy * dy), 1.15) * patch.weight
    if (value > first) { second = first; first = value }
    else if (value > second) second = value
  }
  return Math.min(1, (first + second * .22) * smoothstep(.12, .29, Math.abs(x - .5)))
}

function patchPhase(x: number, y: number): number {
  let strongest = 0
  let index = 0
  patches.forEach((patch, patchIndex) => {
    const dx = (x - patch.x) / patch.rx
    const dy = (y - patch.y) / patch.ry
    const value = Math.max(0, 1 - dx * dx - dy * dy) * patch.weight
    if (value > strongest) { strongest = value; index = patchIndex }
  })
  return index * .83
}

function makeMarks(width: number, height: number): Mark[] {
  const marks: Mark[] = []
  const layers = [
    { step: 12, density: .98, size: 1.5, alpha: .45 },
    { step: 18, density: .92, size: 3.3, alpha: .55 },
    { step: 27, density: .78, size: 5.4, alpha: .57 }
  ]
  layers.forEach((layer, layerIndex) => {
    let index = layerIndex * 100_000
    for (let y = 0; y < height; y += layer.step) {
      for (let x = 0; x < width; x += layer.step) {
        index++
        const px = x + (random(index * 3) - .5) * layer.step * .85
        const py = y + (random(index * 3 + 1) - .5) * layer.step * .85
        const strength = patchStrength(px / width, py / height)
        const grain = .76 + .24 * Math.sin(px * .024 + Math.sin(py * .031) * 2)
        if (random(index * 3 + 2) > layer.density * strength * grain) continue
        marks.push({
          x: px, y: py,
          size: layer.size * (.7 + random(index * 5) * .65),
          alpha: layer.alpha * (.55 + strength * .65) * (.65 + random(index * 7) * .35),
          kind: Math.floor(random(index * 11) * 5),
          // Marks in one patch move together, with just enough local variation.
          phase: patchPhase(px / width, py / height) + layerIndex * .64 + random(index * 13) * .38,
          layer: layerIndex,
          warm: py / height > .43 && random(index * 17) > .58
        })
      }
    }
  })
  return marks
}

function drawMark(ctx: CanvasRenderingContext2D, mark: Mark, x: number, y: number): void {
  const s = mark.size
  switch (mark.kind) {
    case 0:
      ctx.fillRect(x, y, Math.max(1, s * .45), Math.max(1, s * .45))
      break
    case 1:
      ctx.fillRect(x - s * .45, y, s * .9, Math.max(1, s * .2))
      ctx.fillRect(x, y - s * .45, Math.max(1, s * .2), s * .9)
      break
    case 2:
      ctx.beginPath()
      ctx.moveTo(x - s * .35, y + s * .35)
      ctx.lineTo(x + s * .35, y - s * .35)
      ctx.stroke()
      break
    case 3:
      ctx.fillRect(x - s * .5, y, Math.max(1, s * .22), Math.max(1, s * .22))
      ctx.fillRect(x + s * .3, y, Math.max(1, s * .22), Math.max(1, s * .22))
      break
    default:
      ctx.beginPath()
      ctx.moveTo(x - s * .3, y - s * .3)
      ctx.lineTo(x + s * .3, y + s * .3)
      ctx.moveTo(x + s * .3, y - s * .3)
      ctx.lineTo(x - s * .3, y + s * .3)
      ctx.stroke()
  }
}

/** Decorative canvas only: the form and extraction path do not depend on it. */
export function mountHeroAscii(container: HTMLElement, hero: HTMLElement): void {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = window.matchMedia('(pointer: fine)')
  const compact = window.matchMedia('(max-width: 600px)')
  const canvas = document.createElement('canvas')
  canvas.className = 'hero-texture-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return

  let marks: Mark[] = []
  let width = 0
  let height = 0
  let frame = 0
  let lastFrame = 0
  let slowFrames = 0
  let visible = true
  let active = false
  let mouseX = -1000
  let mouseY = -1000
  let targetX = -1000
  let targetY = -1000
  let repel = 0

  const eligible = (): boolean => visible && !document.hidden && !motion.matches && pointer.matches && !compact.matches
  const resize = (): void => {
    const bounds = hero.getBoundingClientRect()
    width = bounds.width
    height = bounds.height
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    marks = makeMarks(width, height)
  }

  const render = (now: number): void => {
    ctx.clearRect(0, 0, width, height)
    mouseX += (targetX - mouseX) * .18
    mouseY += (targetY - mouseY) * .18
    repel += ((active ? 1 : 0) - repel) * .09
    for (const mark of marks) {
      const drift = Math.sin(now * (.00024 + mark.layer * .00007) + mark.phase) * (1 + mark.layer * .5)
      let x = mark.x + drift
      let y = mark.y + drift * .36
      const dx = x - mouseX
      const dy = y - mouseY
      const distance = Math.hypot(dx, dy)
      const radius = 135 + mark.layer * 12
      if (repel > .005 && distance < radius) {
        const force = Math.pow(1 - distance / radius, 2) * (58 + mark.layer * 18) * repel
        const angle = distance < 1 ? mark.phase : Math.atan2(dy, dx)
        x += Math.cos(angle) * force
        y += Math.sin(angle) * force
      }
      ctx.globalAlpha = mark.alpha * (.91 + Math.sin(now * .0008 + mark.phase) * .09)
      ctx.fillStyle = mark.warm ? '#ffc59c' : mark.layer === 0 ? '#80bbff' : '#d3e5ff'
      ctx.strokeStyle = ctx.fillStyle
      ctx.lineWidth = mark.layer === 2 ? 1.15 : 1
      drawMark(ctx, mark, x, y)
    }
    ctx.globalAlpha = 1
  }

  const tick = (now: number): void => {
    if (!eligible()) { frame = 0; return }
    frame = requestAnimationFrame(tick)
    if (now - lastFrame < 33) return
    if (lastFrame && now - lastFrame > 90) slowFrames++
    else slowFrames = Math.max(0, slowFrames - 1)
    if (slowFrames >= 8) { cancelAnimationFrame(frame); frame = 0; return }
    lastFrame = now
    render(now)
  }

  const reconcile = (): void => {
    if (!eligible()) {
      cancelAnimationFrame(frame)
      frame = 0
      canvas.remove()
      return
    }
    if (!canvas.isConnected) { container.appendChild(canvas); resize() }
    if (!frame) {
      lastFrame = 0
      slowFrames = 0
      frame = requestAnimationFrame(tick)
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    const bounds = hero.getBoundingClientRect()
    targetX = event.clientX - bounds.left
    targetY = event.clientY - bounds.top
    if (!active) { mouseX = targetX; mouseY = targetY }
    active = true
  }
  const onPointerLeave = (): void => { active = false }
  const observer = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting)
    reconcile()
  }, { threshold: .05 })
  const resizer = new ResizeObserver(() => { if (canvas.isConnected) resize() })
  observer.observe(hero)
  resizer.observe(hero)
  hero.addEventListener('pointermove', onPointerMove, { passive: true })
  hero.addEventListener('pointerleave', onPointerLeave)
  for (const query of [motion, pointer, compact]) query.addEventListener('change', reconcile)
  document.addEventListener('visibilitychange', reconcile)
  reconcile()
}
