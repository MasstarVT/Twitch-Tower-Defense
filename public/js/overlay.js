import { Net } from './net.js';
import { Sprites } from './sprites.js';
import { Renderer } from './renderer.js';

const canvas = document.getElementById('game');
const wrap = document.getElementById('wrap');
const sprites = new Sprites();
const renderer = new Renderer(canvas, sprites, { showHud: true });
const net = new Net();

net.on('init', (msg) => {
  renderer.init(msg);
  const o = msg.map.overlay || {};
  wrap.style.transform = `translate(${o.offsetX || 0}px, ${o.offsetY || 0}px) scale(${o.scale || 1})`;
});
net.on('state', (s) => renderer.setState(s));
net.on('toast', (t) => renderer.addToast(t));

sprites.load().then(() => { renderer.pathCanvas = null; });

function frame() { renderer.draw(); requestAnimationFrame(frame); }
frame();
