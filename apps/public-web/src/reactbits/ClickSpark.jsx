// Adapted from the React Bits ClickSpark JS-CSS source supplied for this task.
// The host page is not React, so target supplies the existing Hero click area.
import { useEffect, useRef } from 'react';
import './ClickSpark.css';

export default function ClickSpark({
  target,
  sparkColor = '#fff',
  sparkSize = 10,
  sparkRadius = 15,
  sparkCount = 8,
  duration = 400,
  easing = 'ease-out',
  extraScale = 1
}) {
  const canvasRef = useRef(null);
  const sparksRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !target) return;

    let frame = 0;
    let pixelRatio = 1;

    const resize = () => {
      const rect = target.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * pixelRatio);
      canvas.height = Math.round(rect.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const ease = t => {
      switch (easing) {
        case 'linear': return t;
        case 'ease-in': return t * t;
        case 'ease-in-out': return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        default: return t * (2 - t);
      }
    };

    const draw = timestamp => {
      frame = 0;
      const rect = target.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      sparksRef.current = sparksRef.current.filter(spark => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= duration) return false;
        const progress = ease(Math.max(0, elapsed / duration));
        const distance = progress * sparkRadius * extraScale;
        const length = sparkSize * (1 - progress);
        const cos = Math.cos(spark.angle);
        const sin = Math.sin(spark.angle);
        context.strokeStyle = sparkColor;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(spark.x + distance * cos, spark.y + distance * sin);
        context.lineTo(spark.x + (distance + length) * cos, spark.y + (distance + length) * sin);
        context.stroke();
        return true;
      });
      if (sparksRef.current.length) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, rect.width, rect.height);
    };

    const handleClick = event => {
      // Keyboard-generated clicks have no pointer coordinates; controls still work normally.
      if (event.detail === 0) return;
      const rect = target.getBoundingClientRect();
      const now = performance.now();
      sparksRef.current.push(...Array.from({ length: sparkCount }, (_, index) => ({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        angle: 2 * Math.PI * index / sparkCount,
        startTime: now
      })));
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(target);
    resize();
    target.addEventListener('click', handleClick);
    return () => {
      target.removeEventListener('click', handleClick);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      sparksRef.current = [];
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [target, sparkColor, sparkSize, sparkRadius, sparkCount, duration, easing, extraScale]);

  return <canvas className="w2l-click-spark-canvas" ref={canvasRef} aria-hidden="true" />;
}
