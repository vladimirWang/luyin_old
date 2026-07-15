import { useEffect, useRef } from "react";

export function WaveCanvas({ active, level }) {
  const canvasRef = useRef(null);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let frame = 0;
    let rafId = 0;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth * ratio;
      const height = canvas.clientHeight * ratio;

      if (width <= 0 || height <= 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, width, height);
      context.lineWidth = 2 * ratio;
      context.lineCap = "round";

      const centerY = height * 0.5;
      const baseAmplitude = activeRef.current ? 0.16 + levelRef.current * 0.58 : 0.16;
      const lineCount = 44;

      for (let i = 0; i < lineCount; i += 1) {
        const progress = i / (lineCount - 1);
        const red = Math.round(235 - progress * 92);
        const green = Math.round(86 + progress * 42);
        const blue = Math.round(90 + progress * 150);
        const phase = frame * (activeRef.current ? 0.04 : 0.012) + i * 0.12;
        const amplitude = height * baseAmplitude * (0.84 + Math.sin(frame * 0.02 + i * 0.18) * 0.15);
        const offset = (i - lineCount / 2) * height * 0.005;

        context.strokeStyle = `rgba(${red}, ${green}, ${blue}, 0.88)`;
        context.beginPath();

        for (let x = -width * 0.08; x <= width * 1.08; x += width / 130) {
          const nx = x / width;
          const envelope =
            Math.sin(Math.PI * Math.min(1, Math.max(0, nx))) *
            (0.62 + 0.38 * Math.sin(nx * Math.PI * 2 + frame * 0.008));
          const wave =
            Math.sin(nx * Math.PI * 2.25 + phase) * envelope +
            Math.sin(nx * Math.PI * 4.1 - phase * 0.45) * 0.16;
          const y = centerY + wave * amplitude + offset;

          if (x === -width * 0.08) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        context.stroke();
      }

      context.strokeStyle = "rgba(61, 126, 226, 0.85)";
      context.lineWidth = 2 * ratio;
      const markerX = width * 0.5;
      context.beginPath();
      context.moveTo(markerX, height * 0.2);
      context.lineTo(markerX, height * 0.78);
      context.stroke();

      context.fillStyle = "rgba(61, 126, 226, 0.95)";
      context.beginPath();
      context.moveTo(markerX - 9 * ratio, height * 0.19);
      context.lineTo(markerX + 9 * ratio, height * 0.19);
      context.lineTo(markerX, height * 0.25);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(markerX - 9 * ratio, height * 0.8);
      context.lineTo(markerX + 9 * ratio, height * 0.8);
      context.lineTo(markerX, height * 0.74);
      context.closePath();
      context.fill();

      frame += 1;
      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, []);

  return <canvas ref={canvasRef} className="wave-canvas" aria-label="录音波形" />;
}
