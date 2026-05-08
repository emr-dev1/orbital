// Procedural canvas-painted textures and the sun glow sprite.
// Each texture has a "prime meridian" hairline so axial rotation is
// visible even on featureless bodies.

import * as THREE from 'three';

export function makePlanetTexture(name, baseHex) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  const base = '#' + baseHex.toString(16).padStart(6, '0');

  const shade = (hex, amt) => {
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  };

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 512);

  if (name === 'EARTH') {
    ctx.fillStyle = '#1a4a8a';
    ctx.fillRect(0, 0, 1024, 512);
    const continents = [
      { x: 180, y: 180, w: 160, h: 130 },
      { x: 140, y: 120, w: 120, h: 90 },
      { x: 380, y: 140, w: 220, h: 130 },
      { x: 700, y: 200, w: 140, h: 180 },
      { x: 850, y: 380, w: 100, h: 50 },
      { x: 0,   y: 460, w: 1024, h: 60 },
    ];
    for (const cont of continents) {
      ctx.fillStyle = '#3a7a3a';
      for (let i = 0; i < 60; i++) {
        const cx = cont.x + Math.random() * cont.w;
        const cy = cont.y + Math.random() * cont.h;
        const r = 12 + Math.random() * 28;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      }
      ctx.fillStyle = '#b8956a';
      for (let i = 0; i < 15; i++) {
        const cx = cont.x + Math.random() * cont.w;
        const cy = cont.y + Math.random() * cont.h;
        ctx.beginPath(); ctx.arc(cx, cy, 6 + Math.random()*12, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 100; i++) {
      const cx = Math.random()*1024, cy = Math.random()*512;
      ctx.beginPath(); ctx.arc(cx, cy, 8 + Math.random()*22, 0, Math.PI*2); ctx.fill();
    }
  }
  else if (name === 'JUPITER' || name === 'SATURN') {
    const bandCount = name === 'JUPITER' ? 14 : 10;
    for (let i = 0; i < bandCount; i++) {
      const y0 = (i / bandCount) * 512;
      const y1 = ((i + 1) / bandCount) * 512;
      const offset = (Math.random() - 0.5) * 0.25;
      ctx.fillStyle = shade(baseHex, offset);
      ctx.fillRect(0, y0, 1024, y1 - y0);
    }
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = shade(baseHex, (Math.random() - 0.5) * 0.3);
      const cx = Math.random()*1024, cy = Math.random()*512;
      ctx.beginPath(); ctx.ellipse(cx, cy, 8 + Math.random()*18, 2 + Math.random()*4, 0, 0, Math.PI*2); ctx.fill();
    }
    if (name === 'JUPITER') {
      ctx.fillStyle = '#a04020';
      ctx.beginPath(); ctx.ellipse(620, 320, 60, 26, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#c46040';
      ctx.beginPath(); ctx.ellipse(620, 320, 45, 18, 0, 0, Math.PI*2); ctx.fill();
    }
  }
  else if (name === 'MARS') {
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = shade(baseHex, (Math.random() - 0.5) * 0.35);
      const cx = Math.random()*1024, cy = Math.random()*512;
      ctx.beginPath(); ctx.arc(cx, cy, 4 + Math.random()*16, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(240,240,250,0.85)';
    ctx.fillRect(0, 0, 1024, 28);
    ctx.fillRect(0, 484, 1024, 28);
  }
  else if (name === 'VENUS') {
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = shade(baseHex, (Math.random() - 0.5) * 0.2);
      const cx = Math.random()*1024, cy = Math.random()*512;
      ctx.beginPath(); ctx.ellipse(cx, cy, 20 + Math.random()*40, 6 + Math.random()*12, 0, 0, Math.PI*2); ctx.fill();
    }
  }
  else if (name === 'MERCURY' || name === 'MOON') {
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = shade(baseHex, (Math.random() - 0.5) * 0.4);
      const cx = Math.random()*1024, cy = Math.random()*512;
      ctx.beginPath(); ctx.arc(cx, cy, 2 + Math.random()*14, 0, Math.PI*2); ctx.fill();
    }
    if (name === 'MOON') {
      ctx.fillStyle = shade(baseHex, -0.25);
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.arc(Math.random()*1024, Math.random()*512, 30 + Math.random()*50, 0, Math.PI*2);
        ctx.fill();
      }
    }
  }
  else if (name === 'URANUS' || name === 'NEPTUNE') {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = shade(baseHex, (Math.random() - 0.5) * 0.15);
      ctx.fillRect(0, (i/6)*512, 1024, 512/6);
    }
    if (name === 'NEPTUNE') {
      ctx.fillStyle = '#1a3a8a';
      ctx.beginPath(); ctx.ellipse(450, 280, 50, 25, 0, 0, Math.PI*2); ctx.fill();
    }
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = shade(baseHex, (Math.random() - 0.5) * 0.18);
      const cx = Math.random()*1024, cy = Math.random()*512;
      ctx.beginPath(); ctx.ellipse(cx, cy, 10 + Math.random()*20, 3 + Math.random()*5, 0, 0, Math.PI*2); ctx.fill();
    }
  }
  else if (name === 'SUN') {
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(255,${180 + Math.random()*60 | 0},${60 + Math.random()*80 | 0},${0.3 + Math.random()*0.5})`;
      const cx = Math.random()*1024, cy = Math.random()*512;
      ctx.beginPath(); ctx.arc(cx, cy, 1 + Math.random()*5, 0, Math.PI*2); ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#883300';
      ctx.beginPath(); ctx.arc(Math.random()*1024, Math.random()*512, 6 + Math.random()*10, 0, Math.PI*2); ctx.fill();
    }
  }

  // Prime-meridian hairline at u=0 plus a small north-pole patch so axial
  // rotation is unmistakable on featureless bodies (Moon, Mercury). Tinted
  // accent on the Moon to call out tidal lock once we visualize it.
  const meridianAlpha = (name === 'MOON' || name === 'MERCURY') ? 0.55 : 0.22;
  const meridianWidth = (name === 'MOON' || name === 'MERCURY') ? 3 : 1;
  ctx.strokeStyle = name === 'MOON' ? `rgba(255,170,120,${meridianAlpha})` : `rgba(255,255,255,${meridianAlpha})`;
  ctx.lineWidth = meridianWidth;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 512); ctx.stroke();
  // Tiny pole cap on featureless bodies — confirms rotation axis at a glance.
  if (name === 'MOON' || name === 'MERCURY') {
    ctx.fillStyle = name === 'MOON' ? 'rgba(255,170,120,0.6)' : 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 512, 18, 0, Math.PI*2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function makeGlowSprite(color, size) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128,128,0,128,128,128);
  const hex = '#' + color.toString(16).padStart(6,'0');
  g.addColorStop(0, hex);
  g.addColorStop(0.4, hex + 'aa');
  g.addColorStop(1, '#00000000');
  ctx.fillStyle = g; ctx.fillRect(0,0,256,256);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(mat); s.scale.set(size, size, 1);
  return s;
}
