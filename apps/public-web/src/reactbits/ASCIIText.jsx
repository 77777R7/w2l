// Adapted from the React Bits ASCIIText JS-CSS registry source:
// https://reactbits.dev/r/ASCIIText-JS-CSS.json
// The W2L version keeps the text-to-ASCII renderer while limiting motion,
// removing external fonts and inline styles, and tracking only its Hero.

import { useEffect, useRef } from 'react';
import { CanvasTexture, Mesh, NearestFilter, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer } from 'three';
import './ASCIIText.css';

const vertexShader = `
varying vec2 vUv;
uniform float uTime;
uniform float mouse;
uniform float uEnableWaves;

void main() {
    vUv = uv;
    float time = uTime * 5.;

    float waveFactor = uEnableWaves;

    vec3 transformed = position;

    transformed.x += sin(time + position.y) * 0.5 * waveFactor;
    transformed.y += cos(time + position.z) * 0.15 * waveFactor;
    transformed.z += sin(time + position.x) * waveFactor;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const fragmentShader = `
varying vec2 vUv;
uniform float mouse;
uniform float uTime;
uniform sampler2D uTexture;

void main() {
    float time = uTime;
    vec2 pos = vUv;

    float move = sin(time + mouse) * 0.01;
    float r = texture2D(uTexture, pos + cos(time * 2. - time + pos.x) * .01).r;
    float g = texture2D(uTexture, pos + tan(time * .5 + pos.x - time) * .01).g;
    float b = texture2D(uTexture, pos - cos(time * 2. + time + pos.y) * .01).b;
    float a = texture2D(uTexture, pos).a;
    gl_FragColor = vec4(r, g, b, a);
}
`;

const mapRange = (n, start, stop, start2, stop2) => {
  return ((n - start) / (stop - start)) * (stop2 - start2) + start2;
};

class AsciiFilter {
  constructor(renderer, { fontSize, fontFamily, charset, invert } = {}) {
    this.renderer = renderer;
    this.domElement = document.createElement('div');
    this.domElement.className = 'w2l-ascii-filter';

    this.pre = document.createElement('pre');
    this.domElement.appendChild(this.pre);

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.context = this.canvas.getContext('2d');
    this.domElement.appendChild(this.canvas);

    this.invert = invert ?? true;
    this.fontSize = fontSize ?? 12;
    this.fontFamily = fontFamily ?? "'Courier New', monospace";
    this.charset = charset ?? ' .\'`^",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
    this.pointer = { x: -1000, y: -1000, active: false };
    this.repel = 0;

    this.context.webkitImageSmoothingEnabled = false;
    this.context.mozImageSmoothingEnabled = false;
    this.context.msImageSmoothingEnabled = false;
    this.context.imageSmoothingEnabled = false;

  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.reset();

  }

  reset() {
    this.context.font = `${this.fontSize}px ${this.fontFamily}`;
    const charWidth = this.context.measureText('A').width;
    this.charWidth = charWidth;

    this.cols = Math.floor(this.width / (this.fontSize * (charWidth / this.fontSize)));
    this.rows = Math.floor(this.height / this.fontSize);

    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
  }

  render(scene, camera) {
    this.renderer.render(scene, camera);

    const w = this.canvas.width;
    const h = this.canvas.height;
    this.context.clearRect(0, 0, w, h);
    if (this.context && w && h) {
      this.context.drawImage(this.renderer.domElement, 0, 0, w, h);
    }

    this.asciify(this.context, w, h);
  }

  asciify(ctx, w, h) {
    if (w && h) {
      const imgData = ctx.getImageData(0, 0, w, h).data;
      this.repel += ((this.pointer.active ? 1 : 0) - this.repel) * 0.16;
      let str = '';
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (x + .5) * this.charWidth - this.pointer.x;
          const dy = (y + .5) * this.fontSize - this.pointer.y;
          const distance = Math.hypot(dx, dy);
          const radius = 130;
          if (this.repel > .01 && distance < 38 * this.repel) {
            str += ' ';
            continue;
          }
          let sampleX = x;
          let sampleY = y;
          if (this.repel > .01 && distance < radius && distance > 0) {
            // Inverse sampling shifts the actual ASCII glyphs outward, rather
            // than just hiding an image underneath a cursor-shaped mask.
            const pull = Math.pow(1 - distance / radius, 2) * 72 * this.repel;
            sampleX -= (dx / distance) * pull / this.charWidth;
            sampleY -= (dy / distance) * pull / this.fontSize;
          }
          const sx = Math.round(sampleX);
          const sy = Math.round(sampleY);
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) { str += ' '; continue; }
          const i = (sx + sy * w) * 4;
          const [r, g, b, a] = [imgData[i], imgData[i + 1], imgData[i + 2], imgData[i + 3]];

          if (a === 0) {
            str += ' ';
            continue;
          }

          let gray = (0.3 * r + 0.6 * g + 0.1 * b) / 255;
          let idx = Math.floor((1 - gray) * (this.charset.length - 1));
          if (this.invert) idx = this.charset.length - idx - 1;
          str += this.charset[idx];
        }
        str += '\n';
      }
      this.pre.textContent = str;
    }
  }

  setPointer(x, y, active) {
    this.pointer = { x, y, active };
  }

}

class CanvasTxt {
  constructor(txt, { fontSize = 200, fontFamily = 'Arial', color = '#fdf9f3' } = {}) {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    this.txt = txt;
    this.fontSize = fontSize;
    this.fontFamily = fontFamily;
    this.color = color;

    this.font = `600 ${this.fontSize}px ${this.fontFamily}`;
  }

  resize() {
    this.context.font = this.font;
    const metrics = this.context.measureText(this.txt);

    const textWidth = Math.ceil(metrics.width) + 20;
    const textHeight = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 20;

    this.canvas.width = textWidth;
    this.canvas.height = textHeight;
  }

  render() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.fillStyle = this.color;
    this.context.font = this.font;

    const metrics = this.context.measureText(this.txt);
    const yPos = 10 + metrics.actualBoundingBoxAscent;

    this.context.fillText(this.txt, 10, yPos);
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
  }

  get texture() {
    return this.canvas;
  }
}

class CanvAscii {
  constructor(
    { text, asciiFontSize, textFontSize, textColor, planeBaseHeight, enableWaves },
    containerElem,
    width,
    height
  ) {
    this.textString = text;
    this.asciiFontSize = asciiFontSize;
    this.textFontSize = textFontSize;
    this.textColor = textColor;
    this.planeBaseHeight = planeBaseHeight;
    this.container = containerElem;
    this.width = width;
    this.height = height;
    this.enableWaves = enableWaves;

    this.camera = new PerspectiveCamera(45, this.width / this.height, 1, 1000);
    this.camera.position.z = 30;

    this.scene = new Scene();
    this.mouse = { x: this.width / 2, y: this.height / 2 };

    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseLeave = this.onMouseLeave.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.running = false;
    this.visible = false;
    this.lastFrame = 0;
    this.slowFrames = 0;
  }

  init() {
    this.setMesh();
    this.setRenderer();
  }

  setMesh() {
    this.textCanvas = new CanvasTxt(this.textString, {
      fontSize: this.textFontSize,
      fontFamily: 'Courier New',
      color: this.textColor
    });
    this.textCanvas.resize();
    this.textCanvas.render();

    this.texture = new CanvasTexture(this.textCanvas.texture);
    this.texture.minFilter = NearestFilter;

    const textAspect = this.textCanvas.width / this.textCanvas.height;
    const baseH = this.planeBaseHeight;
    const planeW = baseH * textAspect;
    const planeH = baseH;

    this.geometry = new PlaneGeometry(planeW, planeH, 36, 36);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        mouse: { value: 1.0 },
        uTexture: { value: this.texture },
        uEnableWaves: { value: this.enableWaves ? 1.0 : 0.0 }
      }
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);
  }

  setRenderer() {
    this.renderer = new WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);

    this.filter = new AsciiFilter(this.renderer, {
      fontFamily: 'Courier New',
      fontSize: this.asciiFontSize,
      charset: ' ·+x<>/',
      invert: true
    });

    this.container.appendChild(this.filter.domElement);
    this.setSize(this.width, this.height);

    this.pointerTarget = this.container.closest('.hero') ?? this.container;
    this.pointerTarget.addEventListener('pointermove', this.onMouseMove, { passive: true });
    this.pointerTarget.addEventListener('pointerleave', this.onMouseLeave);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.filter.setSize(w, h);

    this.center = { x: w / 2, y: h / 2 };
  }

  load() {
    if (this.running || document.hidden || !this.visible) return;
    this.running = true;
    this.lastFrame = 0;
    this.slowFrames = 0;
    this.animate();
  }

  onMouseMove(evt) {
    const bounds = this.pointerTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (evt.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (evt.clientY - bounds.top) / bounds.height));
    this.mouse = { x: x * this.width, y: y * this.height };
    const local = this.container.getBoundingClientRect();
    this.filter.setPointer(evt.clientX - local.left, evt.clientY - local.top, true);
  }

  onMouseLeave() {
    this.mouse = { x: this.width / 2, y: this.height / 2 };
    this.filter.setPointer(-1000, -1000, false);
  }

  onVisibilityChange() {
    if (document.hidden) this.stop();
    else this.load();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animationFrameId);
  }

  animate() {
    const animateFrame = (now) => {
      if (!this.running) return;
      this.animationFrameId = requestAnimationFrame(animateFrame);
      if (now - this.lastFrame < 33) return;
      if (this.lastFrame && now - this.lastFrame > 80) this.slowFrames += 1;
      else this.slowFrames = Math.max(0, this.slowFrames - 1);
      if (this.slowFrames >= 8) { this.stop(); return; }
      this.lastFrame = now;
      this.render();
    };
    this.animationFrameId = requestAnimationFrame(animateFrame);
  }

  render() {
    const time = new Date().getTime() * 0.001;

    this.mesh.material.uniforms.uTime.value = Math.sin(time);

    this.updateRotation();
    this.filter.render(this.scene, this.camera);
  }

  updateRotation() {
    const x = mapRange(this.mouse.y, 0, this.height, 0.18, -0.18);
    const y = mapRange(this.mouse.x, 0, this.width, -0.18, 0.18);

    this.mesh.rotation.x += (x - this.mesh.rotation.x) * 0.05;
    this.mesh.rotation.y += (y - this.mesh.rotation.y) * 0.05;
  }

  clear() {
    this.scene.traverse(obj => {
      if (obj.isMesh && typeof obj.material === 'object' && obj.material !== null) {
        Object.keys(obj.material).forEach(key => {
          const matProp = obj.material[key];
          if (matProp !== null && typeof matProp === 'object' && typeof matProp.dispose === 'function') {
            matProp.dispose();
          }
        });
        obj.material.dispose();
        obj.geometry.dispose();
      }
    });
    this.scene.clear();
  }

  dispose() {
    this.stop();
    if (this.filter) {
      if (this.filter.domElement.parentNode) {
        this.container.removeChild(this.filter.domElement);
      }
    }
    this.pointerTarget?.removeEventListener('pointermove', this.onMouseMove);
    this.pointerTarget?.removeEventListener('pointerleave', this.onMouseLeave);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.clear();
    this.texture?.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
  }
}

export default function ASCIIText({
  text = 'David!',
  asciiFontSize = 8,
  textFontSize = 200,
  textColor = '#fdf9f3',
  planeBaseHeight = 8,
  enableWaves = true
}) {
  const containerRef = useRef(null);
  const asciiRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    let instance;
    try {
      instance = new CanvAscii(
        { text, asciiFontSize, textFontSize, textColor, planeBaseHeight, enableWaves },
        container, width, height
      );
      instance.init();
      asciiRef.current = instance;
    } catch {
      // Decorative WebGL failure must never block the page or its form.
      instance?.dispose();
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      instance.visible = Boolean(entry?.isIntersecting);
      if (instance.visible) instance.load();
      else instance.stop();
    }, { threshold: 0.05 });
    observer.observe(container);
    const ro = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        instance.setSize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(container);
    return () => {
      observer.disconnect();
      ro.disconnect();
      instance.dispose();
      asciiRef.current = null;
    };
  }, [text, asciiFontSize, textFontSize, textColor, planeBaseHeight, enableWaves]);

  return <div ref={containerRef} className="ascii-text-container" aria-hidden="true" />;
}
