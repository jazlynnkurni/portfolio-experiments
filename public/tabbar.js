/* THE TAB BAR (phones only). A glass pill at the bottom with Projects, Sandbox, About, in the manner of the iOS
   tab bar: a frosted bar, and a lens of clearer glass under the current tab. Choosing a tab moves the lens on a
   spring, and while it travels it stretches along its path and thins, the way a drop of liquid moves; the page
   then blurs out and the next one blurs in. The lens can also be dragged across the tabs and let go.
   Hidden in the home's arrival, while a case study is open, and inside the case study frame. */
(function () {
  if (/[?&]sheet=1/.test(location.search)) return;          /* only the case study frame; the iPhone preview is a frame too */
  var mq = matchMedia('(max-width:640px)');
  if (!mq.matches) return;
  var html = document.documentElement;
  if (html.classList.contains('sheet')) return;

  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var SANDBOX = local ? 'http://localhost:3000/sandbox' : 'https://portfolio-experiments.vercel.app/sandbox';
  /* the sandbox is another origin; it sets TABBAR_HOME so Projects and About point back to the site */
  var HOME = window.TABBAR_HOME || '';
  var TABS = [
    { id: 'projects', label: 'Projects', href: HOME + '/' },
    { id: 'sandbox', label: 'Sandbox', href: SANDBOX },
    { id: 'about', label: 'About', href: HOME + '/about.html' }
  ];
  var here = /sandbox/.test(location.pathname) ? 'sandbox' : /about/.test(location.pathname) ? 'about' : 'projects';
  var cur = TABS.findIndex(function (t) { return t.id === here; });

  var css =
    '#tabbar{position:fixed;top:auto;right:auto;height:auto;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);z-index:95;transform:translate(-50%,0);' +
    'display:flex;padding:5px;border-radius:999px;gap:0;touch-action:none;user-select:none;-webkit-user-select:none;' +
    'background:rgba(250,249,247,.62);-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%);' +
    'box-shadow:0 0 0 .5px rgba(20,23,27,.10),0 1px 1px rgba(255,255,255,.9) inset,0 -1px 1px rgba(20,23,27,.04) inset,0 18px 40px -16px rgba(20,23,27,.35);' +
    'transition:transform .5s cubic-bezier(.22,1,.36,1),opacity .35s ease}' +
    'html[data-theme="dark"] #tabbar{background:rgba(38,35,32,.6);box-shadow:0 0 0 .5px rgba(250,249,247,.12),0 1px 1px rgba(255,255,255,.08) inset,0 18px 40px -16px rgba(0,0,0,.6)}' +
    '#tabbar a{position:relative;z-index:2;display:block;padding:10px 18px;font:500 13.5px "Plus Jakarta Sans",sans-serif;letter-spacing:.01em;' +
    'color:rgba(20,23,27,.55);text-decoration:none;transition:color .25s ease;-webkit-tap-highlight-color:transparent}' +
    'html[data-theme="dark"] #tabbar a{color:rgba(250,249,247,.55)}' +
    '#tabbar a.on{color:#14171B}html[data-theme="dark"] #tabbar a.on{color:#FAF9F7}' +
    '#tabbar .lens{position:absolute;z-index:1;top:5px;bottom:5px;left:0;width:0;border-radius:999px;will-change:transform,width;' +
    'background:rgba(255,255,255,.78);' +
    'box-shadow:0 0 0 .5px rgba(20,23,27,.08),inset 0 1px 0 rgba(255,255,255,1),inset 0 -1px 2px rgba(20,23,27,.06),0 6px 14px -6px rgba(20,23,27,.28)}' +
    'html[data-theme="dark"] #tabbar .lens{background:rgba(250,249,247,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 6px 14px -6px rgba(0,0,0,.5)}' +
    
    /* the page change: the outgoing page softens and drops back, the incoming one comes forward out of the blur */
    'html.tab-leave body>*:not(#tabbar){transition:opacity .32s ease,filter .32s ease,transform .38s cubic-bezier(.22,1,.36,1);opacity:0;filter:blur(10px);transform:scale(.985)}' +
    '@keyframes tabIn{from{opacity:0;filter:blur(10px);transform:scale(1.015)}to{opacity:1;filter:none;transform:none}}' +
    'html.tab-enter body>*:not(#tabbar){animation:tabIn .5s cubic-bezier(.22,1,.36,1) both}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var bar = document.createElement('div'); bar.id = 'tabbar'; bar.setAttribute('role', 'navigation'); bar.setAttribute('aria-label', 'Sections');   /* not a <nav>: the site's nav rules would pin it to the top */
  bar.innerHTML = '<span class="lens"></span>' + TABS.map(function (t, i) {
    return '<a href="' + t.href + '" data-i="' + i + '"' + (i === cur ? ' class="on" aria-current="page"' : '') + '>' + t.label + '</a>';
  }).join('');
  document.body.appendChild(bar);
  var lens = bar.querySelector('.lens'), links = [].slice.call(bar.querySelectorAll('a'));

  /* the lens is a spring on two numbers, its left edge and its width; the stretch comes from its speed */
  var S = { x: 0, w: 0, vx: 0, vw: 0, tx: 0, tw: 0, raf: 0, drag: false };
  function slot(i) { var a = links[i]; return { x: a.offsetLeft, w: a.offsetWidth }; }
  function aim(i, snap) { var s = slot(i); S.tx = s.x; S.tw = s.w; if (snap) { S.x = s.x; S.w = s.w; S.vx = S.vw = 0; paint(); } else wake(); }
  function paint() {
    var speed = Math.min(1, Math.abs(S.vx) / 1400);
    var sx = 1 + speed * .22, sy = 1 - speed * .16;          /* longer and thinner the faster it goes */
    lens.style.width = S.w + 'px';
    lens.style.transform = 'translateX(' + S.x.toFixed(2) + 'px) scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')';
  }
  function step(t) {
    var dt = Math.min(.032, (t - (S.last || t)) / 1000); S.last = t;
    var k = 420, c = 2 * Math.sqrt(k) * .62;                 /* a soft, slightly under-damped spring, like SwiftUI's .bouncy */
    S.vx += ((S.tx - S.x) * k - S.vx * c) * dt; S.x += S.vx * dt;
    S.vw += ((S.tw - S.w) * k - S.vw * c) * dt; S.w += S.vw * dt;
    paint();
    if (S.drag || Math.abs(S.tx - S.x) > .3 || Math.abs(S.vx) > 4 || Math.abs(S.tw - S.w) > .3) S.raf = requestAnimationFrame(step);
    else { S.raf = 0; S.last = 0; }
  }
  function wake() { if (!S.raf) S.raf = requestAnimationFrame(step); }

  function setOn(i) { links.forEach(function (a, k) { a.classList.toggle('on', k === i); }); }
  function go(i) {
    setOn(i); aim(i);
    var t = TABS[i];
    if (i === cur) {                                          /* the tab you are on: back to its top */
      if (t.id === 'projects' && window.__crateTo) window.__crateTo(0); else scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (t.id === 'projects') { try { sessionStorage.setItem('home:return', '1'); } catch (e) {} }
    try { sessionStorage.setItem('tab:enter', '1'); sessionStorage.setItem('tab:from', String(cur)); } catch (e) {}
    setTimeout(function () { html.classList.add('tab-leave'); }, 220);
    setTimeout(function () { location.href = t.href; }, 560);
  }

  /* taps, and dragging the lens across the tabs */
  var down = null;
  bar.addEventListener('pointerdown', function (e) { down = { x: e.clientX, moved: false }; bar.setPointerCapture(e.pointerId); });
  bar.addEventListener('pointermove', function (e) {
    if (!down) return; if (Math.abs(e.clientX - down.x) > 6) down.moved = true; if (!down.moved) return;
    S.drag = true; var r = bar.getBoundingClientRect(), x = e.clientX - r.left;
    var near = links.reduce(function (b, a, k) { var m = a.offsetLeft + a.offsetWidth / 2; return Math.abs(m - x) < Math.abs(links[b].offsetLeft + links[b].offsetWidth / 2 - x) ? k : b; }, 0);
    S.tx = x - slot(near).w / 2; S.tw = slot(near).w; setOn(near); wake();
  });
  function up(e) {
    if (!down) return; var moved = down.moved; down = null; S.drag = false;
    var r = bar.getBoundingClientRect(), x = e.clientX - r.left;
    var i = links.reduce(function (b, a, k) { var m = a.offsetLeft + a.offsetWidth / 2; return Math.abs(m - x) < Math.abs(links[b].offsetLeft + links[b].offsetWidth / 2 - x) ? k : b; }, 0);
    go(i);
  }
  bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', function () { down = null; S.drag = false; aim(cur); });
  bar.addEventListener('click', function (e) { e.preventDefault(); });

  /* arriving by a tab: the lens slides in from the tab you came from, and the page comes out of the blur */
  var from = -1; try { if (sessionStorage.getItem('tab:enter') === '1') { from = +sessionStorage.getItem('tab:from'); html.classList.add('tab-enter'); setTimeout(function () { html.classList.remove('tab-enter'); }, 600); } sessionStorage.removeItem('tab:enter'); sessionStorage.removeItem('tab:from'); } catch (e) {}
  requestAnimationFrame(function () { if (from >= 0 && from !== cur) { aim(from, true); setTimeout(function () { aim(cur); }, 60); } else aim(cur, true); });
  addEventListener('resize', function () { aim(cur, true); });
  addEventListener('pageshow', function (e) { if (e.persisted) { html.classList.remove('tab-leave'); setOn(cur); aim(cur, true); } });

  /* on the home it waits for the arrival to finish */
  /* always there: no page, moment or state hides it */
})();
