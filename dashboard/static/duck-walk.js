'use strict';

const track = document.querySelector('.duck-track');
const ducks = track.querySelector('.duck-family');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const speed = 22; // CSS pixels per second
let frame, previousTime, walked, nextStep, nearFoot;

function leavePrint(x) {
  const print = document.createElement('span');
  print.className = 'footprint';
  print.style.left = x + 'px';
  print.style.bottom = nearFoot ? '0' : '2px';
  nearFoot = !nearFoot;
  print.addEventListener('animationend', () => print.remove(), { once: true });
  track.append(print);
}

function walk(time) {
  // A resumed tab picks up at its last position.
  const elapsed = Math.min(time - (previousTime ?? time), 100);
  previousTime = time;
  walked += speed * elapsed / 1000;
  const x = track.clientWidth - walked;
  ducks.style.transform = 'translateX(' + x + 'px)';
  if (walked >= nextStep) {
    const foot = x + ducks.width * 0.90;
    if (foot >= 0 && foot < track.clientWidth) leavePrint(foot);
    nextStep = walked + 10;
  }
  if (x <= -ducks.width - 6) {
    walked = 0;
    nextStep = 0;
  }
  frame = requestAnimationFrame(walk);
}

function startWalk() {
  cancelAnimationFrame(frame);
  track.querySelectorAll('.footprint').forEach(print => print.remove());
  ducks.style.removeProperty('transform');
  ducks.style.removeProperty('right');
  ducks.style.removeProperty('left');
  if (reducedMotion.matches) return;
  walked = track.clientWidth * 0.08 + ducks.width;
  nextStep = walked + 10;
  nearFoot = true;
  previousTime = undefined;
  ducks.style.right = 'auto';
  ducks.style.left = '0';
  frame = requestAnimationFrame(walk);
}

reducedMotion.addEventListener('change', startWalk);
startWalk();
