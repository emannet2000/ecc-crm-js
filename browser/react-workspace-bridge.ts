// Keep the existing transactional forms usable inside the React workspace.
if (window.parent !== window) {
  const style = (document.createElement('style') as any);
  style.textContent = '.ph, #app > .workspace-nav {display:none!important} body{background:#fff} #app > .pt, #app > main.pt{max-width:none!important;padding:16px;margin:0} .card{box-shadow:none;border-color:#e3eaf4;border-radius:6px} h1,h2,h3{color:#142244} .btn.p{background:#a98035;border-color:#a98035} .workspace-nav{border-radius:5px}';
  document.head.append(style);
  document.addEventListener('click', event => {
    const link = ((event.target as Element).closest('a') as any);
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && /\/(?:index\.html)?$/.test(url.pathname) && url.hash.startsWith('#/')) {
      event.preventDefault();
      window.parent.location.hash = url.hash;
    }
  });
}
