(() => {
  const key = 'chirp-appearance';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}

  function apply() {
    const dark = preference === 'dark' || (preference !== 'light' && system.matches);
    document.documentElement.dataset.appearance = dark ? 'dark' : 'light';
    document.querySelector('.appearance-toggle')?.setAttribute('aria-pressed', String(dark));
    window.dispatchEvent(new Event('chirp-appearance'));
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.appearance-toggle');
    apply();
    toggle.addEventListener('click', () => {
      preference = document.documentElement.dataset.appearance === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch {}
      apply();
    });
  });
  system.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = event.newValue;
      apply();
    }
  });
})();
