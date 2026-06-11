// Clock Module
import { DAYS } from './config.js';

export function tick() {
  const n = new Date();
  const hh = String(n.getHours()).padStart(2, '0');
  const mm = String(n.getMinutes()).padStart(2, '0');
  const ss = String(n.getSeconds()).padStart(2, '0');

  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('date-d');

  if (clockEl) clockEl.textContent = `${hh}:${mm}:${ss}`;
  if (dateEl) {
    dateEl.textContent = `${DAYS[n.getDay()]}, ${n.getDate()}/${n.getMonth() + 1}/${n.getFullYear()}`;
  }
}

export function initClock() {
  tick();
  setInterval(tick, 1000);
}
