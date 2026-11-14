(() => {
  const sky = document.querySelector('.night-sky');
  function paint() {
    const width = sky.clientWidth, height = sky.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(devicePixelRatio, 2);
    const night = document.documentElement.dataset.appearance === 'dark';
    sky.width = Math.round(width * scale);
    sky.height = Math.round(height * scale);
    const ctx = sky.getContext('2d');
    ctx.scale(scale, scale);

    // A fixed seed keeps the same sky when the appearance is toggled.
    let seed = 275;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    ctx.fillStyle = '#d3e4df';
    for (let i = 0; night && i < width * height / 5800; i++) {
      const x = random() * width, y = random() * height * .84;
      ctx.globalAlpha = (.2 + random() * .5) * (1 - y / height);
      ctx.beginPath();
      ctx.arc(x, y, .45 + random() * .75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Use the same tree positions in both palettes.
    seed = 275;
    const depth = Math.min(height * .16, 115);
    const layers = [
      { colour: night ? '#294340' : '#d9e4dc', rise: .76, size: .22 },
      { colour: night ? '#203934' : '#c7d8cd', rise: .52, size: .36 },
      { colour: night ? '#192f29' : '#b5cabc', rise: .25, size: .46 }
    ];
    for (const [index, layer] of layers.entries()) {
      ctx.fillStyle = layer.colour;
      const ground = x => height - depth * (layer.rise +
        .13 * Math.sin(x / 145 + index) + .09 * Math.cos(x / 87 - index));
      ctx.beginPath();
      ctx.moveTo(-1, height);
      for (let x = -1; x < width + 10; x += 8) ctx.lineTo(x, ground(x));
      ctx.lineTo(width + 10, height);
      ctx.fill();

      for (let x = -10; x < width + 10;) {
        const y = ground(x), h = depth * layer.size * (.48 + random());
        const w = h * (.13 + random() * .11);
        ctx.beginPath();
        ctx.moveTo(x, y - h);
        for (const side of [1, -1]) {
          if (side < 0) ctx.moveTo(x, y - h);
          for (let tier = 1; tier <= 4; tier++) {
            const fraction = tier / 4;
            ctx.lineTo(x + side * w * fraction, y - h * (1 - fraction) + 2);
            ctx.lineTo(x + side * w * fraction * .43, y - h * (1 - fraction));
          }
          ctx.lineTo(x, y + 3);
          ctx.closePath();
        }
        ctx.fill();
        x += Math.max(3, w * (.8 + random()));
      }
    }
  }
  new ResizeObserver(paint).observe(sky);
  window.addEventListener('chirp-appearance', paint);

  const flight = document.querySelector('.sky-flight');
  const brush = flight.getContext('2d');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let timer, frame;

  function schedule() {
    timer = setTimeout(fly, 10000 + Math.random() * 5000);
  }

  function fly() {
    schedule();
    const night = document.documentElement.dataset.appearance === 'dark';
    const w = flight.clientWidth, h = flight.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(devicePixelRatio, 2);
    flight.width = Math.round(w * scale);
    flight.height = Math.round(h * scale);
    brush.setTransform(scale, 0, 0, scale, 0, 0);
    const x = w * (.15 + Math.random() * .55);
    const y = h * (.2 + Math.random() * .35);
    const distance = Math.min(160, w * .24);
    const duration = night ? 950 : 5800;
    const start = performance.now();
    function draw(time) {
      brush.clearRect(0, 0, w, h);
      const t = (time - start) / duration;
      if (t >= 1) return;
      brush.save();
      if (night) {
        brush.translate(x + distance * t, y + distance * .32 * t);
        brush.rotate(Math.atan(.32));
        brush.globalAlpha = Math.min(1, t * 7, (1 - t) * 4);
        const tail = brush.createLinearGradient(-34, 0, 0, 0);
        tail.addColorStop(0, 'transparent');
        tail.addColorStop(1, '#d9eee7');
        brush.fillStyle = tail;
        brush.fillRect(-34, -.65, 34, 1.3);
        brush.fillStyle = '#effaf6';
        brush.beginPath();
        brush.arc(0, 0, 1.4, 0, Math.PI * 2);
        brush.fill();
      } else {
        brush.translate(-12 + (w + 24) * t, y + Math.sin(t * 5) * 8);
        const wing = Math.sin(t * Math.PI * 20) * 4;
        brush.strokeStyle = '#536c62';
        brush.lineWidth = 1.6;
        brush.lineCap = 'round';
        brush.beginPath();
        brush.moveTo(-8, wing);
        brush.quadraticCurveTo(-4, wing - 1.5, 0, 1.5);
        brush.quadraticCurveTo(3, wing - 1.5, 7, wing);
        brush.stroke();
      }
      brush.restore();
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
  }

  function resetFlight() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    brush.clearRect(0, 0, flight.width, flight.height);
    if (!document.hidden && !reducedMotion.matches) schedule();
  }
  window.addEventListener('chirp-appearance', resetFlight);
  document.addEventListener('visibilitychange', resetFlight);
  reducedMotion.addEventListener('change', resetFlight);
  resetFlight();
})();
