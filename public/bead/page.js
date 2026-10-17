/* page.js: the sample page under every menu, so the glass is read against
   real content. Reads the prototype's name and blurb off <body>. */
(() => {
  const b = document.body;
  b.insertAdjacentHTML('afterbegin', `<div class="field" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="back"><a href="./">menu lab</a><b>${b.dataset.name || ''}</b><span>${b.dataset.blurb || ''}</span></div>`);
  b.insertAdjacentHTML('beforeend', `<main class="page">
    <div class="label">Case study</div>
    <h1>A menu should arrive the way a thought does, all at once and from nowhere in particular.</h1>
    <p>This page exists so the glass has something to be made of. Move to the top of the window and the menu will find you. Every motion is a spring, so it overshoots and settles, and nothing is on a timer.</p>
    <div class="plate" aria-hidden="true"></div>
    <p>Projects, Sandbox, About and Contact are the four things a visitor can want. The question each prototype answers differently is where those four are when you are not looking for them.</p>
    <p>Hold the pointer on the menu to keep it open. Leave and it goes back to being almost nothing.</p>
  </main>`);
})();
