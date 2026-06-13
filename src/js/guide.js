// Guide Module

export function openGuide(event) {
  if (event) event.preventDefault();
  const guideOverlay = document.getElementById('guide-overlay');
  if (guideOverlay) {
    guideOverlay.classList.add('show');
    // Mặc định mở trang hướng dẫn 1 (id thật là p1..p4)
    showPage('p1', document.getElementById('tab1'));
  }
}

export function closeGuide() {
  const guideOverlay = document.getElementById('guide-overlay');
  if (guideOverlay) {
    guideOverlay.classList.remove('show');
  }
}

export function showPage(id, tabElement) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  const pageEl = document.getElementById(id);
  if (pageEl) pageEl.classList.add('active');

  if (tabElement) tabElement.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  const guideOverlay = document.getElementById('guide-overlay');
  if (guideOverlay) guideOverlay.scrollTo({ top: 0, behavior: 'smooth' });
}

export function initGuideEvents() {
  // Expose to window temporarily if needed, but preferably bind directly
  // We'll bind it in main.index.js
}
