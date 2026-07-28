import { useEffect, useRef } from 'react';
import './AnimatedBackground.css';

// المكون ده منقول 1:1 من الـ IIFE اللي كانت جوا <script> في index.html و set-password.html
// (نفس الأكواد بالظبط في الملفين، فبقى مكون مشترك واحد بدل التكرار).
export default function AnimatedBackground() {
  const waveCanvasRef = useRef(null);
  const particleCanvasRef = useRef(null);

  useEffect(() => {
    const canvas = waveCanvasRef.current;
    const ctx = canvas.getContext('2d');
    let w, h;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const waves = [
      { yBase: 0.15, amplitude: 30, frequency: 0.003, speed: 0.0004, color: 'rgba(56, 189, 248, 0.12)', width: 1 },
      { yBase: 0.18, amplitude: 20, frequency: 0.004, speed: 0.0005, color: 'rgba(30, 136, 229, 0.08)', width: 0.8 },
      { yBase: 0.82, amplitude: 25, frequency: 0.0035, speed: -0.0004, color: 'rgba(20, 184, 166, 0.1)', width: 1 },
      { yBase: 0.85, amplitude: 18, frequency: 0.0045, speed: -0.0005, color: 'rgba(56, 189, 248, 0.07)', width: 0.8 },
      { yBase: 0.5, amplitude: 15, frequency: 0.002, speed: 0.0003, color: 'rgba(124, 58, 237, 0.04)', width: 0.6 },
    ];

    function drawWaves(time) {
      ctx.clearRect(0, 0, w, h);
      waves.forEach((wave) => {
        ctx.beginPath();
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = wave.width;
        const baseY = h * wave.yBase;
        for (let x = 0; x <= w; x += 2) {
          const y =
            baseY +
            Math.sin(x * wave.frequency + time * wave.speed) * wave.amplitude +
            Math.sin(x * wave.frequency * 0.5 + time * wave.speed * 1.3) * wave.amplitude * 0.5;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    }

    const pCanvas = particleCanvasRef.current;
    const pCtx = pCanvas.getContext('2d');
    let pw, ph;

    function resizeP() {
      pw = pCanvas.width = window.innerWidth;
      ph = pCanvas.height = window.innerHeight;
    }
    resizeP();
    window.addEventListener('resize', resizeP);

    class Particle {
      constructor() {
        this.reset();
      }
      reset() {
        const angle = Math.random() * Math.PI * 2;
        const minDist = Math.min(pw, ph) * 0.2;
        const maxDist = Math.min(pw, ph) * 0.55;
        const dist = minDist + Math.random() * (maxDist - minDist);
        this.x = pw / 2 + Math.cos(angle) * dist * (0.8 + Math.random() * 0.4);
        this.y = ph / 2 + Math.sin(angle) * dist * (0.8 + Math.random() * 0.4);
        this.x = Math.max(10, Math.min(pw - 10, this.x));
        this.y = Math.max(10, Math.min(ph - 10, this.y));
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.radius = Math.max(0.5, Math.random() * 1.8);
        this.opacity = 0.1 + Math.random() * 0.4;
        const colorChoice = Math.random();
        if (colorChoice < 0.35) this.color = { r: 56, g: 189, b: 248 };
        else if (colorChoice < 0.65) this.color = { r: 30, g: 136, b: 229 };
        else if (colorChoice < 0.85) this.color = { r: 20, g: 184, b: 166 };
        else this.color = { r: 124, g: 58, b: 237 };
        this.pulseSpeed = 0.001 + Math.random() * 0.002;
        this.pulseOffset = Math.random() * Math.PI * 2;
      }
      update(time) {
        this.x += this.vx;
        this.y += this.vy;
        const dx = this.x - pw / 2;
        const dy = this.y - ph / 2;
        const distFromCenter = Math.sqrt(dx * dx + dy * dy);
        const minAllowedDist = Math.min(pw, ph) * 0.15;
        if (distFromCenter < minAllowedDist) {
          const pushStrength = 0.02;
          this.vx += (dx / Math.max(1, distFromCenter)) * pushStrength;
          this.vy += (dy / Math.max(1, distFromCenter)) * pushStrength;
        }
        if (this.x < -20 || this.x > pw + 20 || this.y < -20 || this.y > ph + 20) this.reset();
        this.vx *= 0.999;
        this.vy *= 0.999;
        this.currentOpacity = this.opacity * (0.6 + 0.4 * Math.sin(time * this.pulseSpeed + this.pulseOffset));
      }
      draw() {
        const { r, g, b } = this.color;
        const op = this.currentOpacity;
        pCtx.beginPath();
        pCtx.arc(this.x, this.y, this.radius * 4, 0, Math.PI * 2);
        pCtx.fillStyle = `rgba(${r},${g},${b},${op * 0.1})`;
        pCtx.fill();
        pCtx.beginPath();
        pCtx.arc(this.x, this.y, Math.max(0.3, this.radius), 0, Math.PI * 2);
        pCtx.fillStyle = `rgba(${r},${g},${b},${op})`;
        pCtx.fill();
      }
    }

    const particleCount = Math.min(80, Math.floor((window.innerWidth * window.innerHeight) / 20000));
    const particles = [];
    for (let i = 0; i < particleCount; i++) particles.push(new Particle());

    const maxConnectionDist = 180;

    function drawConnections() {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxConnectionDist) {
            const alpha = (1 - dist / maxConnectionDist) * 0.08;
            const c1 = particles[i].color;
            const c2 = particles[j].color;
            const mr = Math.round((c1.r + c2.r) / 2);
            const mg = Math.round((c1.g + c2.g) / 2);
            const mb = Math.round((c1.b + c2.b) / 2);
            pCtx.beginPath();
            pCtx.moveTo(particles[i].x, particles[i].y);
            pCtx.lineTo(particles[j].x, particles[j].y);
            pCtx.strokeStyle = `rgba(${mr},${mg},${mb},${alpha})`;
            pCtx.lineWidth = 0.5;
            pCtx.stroke();
          }
        }
      }
    }

    let startTime = null;
    let rafId;
    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      const time = timestamp - startTime;
      drawWaves(time);
      pCtx.clearRect(0, 0, pw, ph);
      particles.forEach((p) => p.update(time));
      drawConnections();
      particles.forEach((p) => p.draw());
      rafId = requestAnimationFrame(animate);
    }
    rafId = requestAnimationFrame(animate);

    const resetOnResize = () => particles.forEach((p) => p.reset());
    window.addEventListener('resize', resetOnResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('resize', resizeP);
      window.removeEventListener('resize', resetOnResize);
    };
  }, []);

  return (
    <div className="background-container">
      <div className="base-gradient"></div>

      <div className="aurora-layer">
        <div className="aurora-band aurora-band-1"></div>
        <div className="aurora-band aurora-band-2"></div>
        <div className="aurora-band aurora-band-3"></div>
      </div>

      <div className="light-source light-1"></div>
      <div className="light-source light-2"></div>
      <div className="light-source light-3"></div>
      <div className="light-source light-4"></div>

      <div className="glass-surface glass-1"></div>
      <div className="glass-surface glass-2"></div>
      <div className="glass-surface glass-3"></div>
      <div className="glass-surface glass-4"></div>

      <div className="chat-bubble bubble-1">
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
      </div>
      <div className="chat-bubble bubble-2">
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
      </div>
      <div className="chat-bubble bubble-3">
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
      </div>
      <div className="chat-bubble bubble-4">
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
      </div>
      <div className="chat-bubble bubble-5">
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
      </div>
      <div className="chat-bubble bubble-6">
        <div className="bubble-line"></div>
        <div className="bubble-line"></div>
      </div>

      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      <div className="orb orb-4"></div>
      <div className="orb orb-5"></div>
      <div className="orb orb-6"></div>

      <canvas id="waveCanvas" ref={waveCanvasRef}></canvas>
      <canvas id="particleCanvas" ref={particleCanvasRef}></canvas>

      <div className="center-vignette"></div>

      <div className="edge-glow edge-glow-top"></div>
      <div className="edge-glow edge-glow-bottom"></div>
      <div className="edge-glow edge-glow-left"></div>
      <div className="edge-glow edge-glow-right"></div>

      <div className="noise-overlay"></div>
    </div>
  );
}
