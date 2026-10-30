// Generated from browser/localization.ts; edit the TypeScript source.
(() => {
    let dictionary = {}, locale = 'en', direction = 'ltr', available = [], busy = false;
    const originals = new WeakMap();
    async function choose(code, persist = false) { const response = await fetch('/v1/public/locales/' + encodeURIComponent(code)); if (!response.ok)
        throw Error('LANGUAGE_UNAVAILABLE'); const data = await response.json(); dictionary = data.dictionary; locale = data.locale; direction = data.direction; localStorage.setItem('ecc_locale', locale); apply(); if (persist && typeof portalApi === 'function' && (typeof portalToken === 'string' || typeof me !== 'undefined' && me?.portal_role === 'client'))
        await portalApi('/language', { method: 'POST', body: { locale } }); }
    function apply() {
        if (busy)
            return;
        busy = true;
        try {
            document.documentElement.lang = locale;
            document.documentElement.dir = direction;
            const root = document.getElementById('app') || document.body;
            if (!root)
                return;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (node.parentElement.closest('script,style,textarea,pre,code,option,[data-no-translate]'))
                    continue;
                const old = originals.get(node);
                const source = old?.translated === node.nodeValue ? old.source : node.nodeValue;
                const trimmed = source.trim(), translation = dictionary[trimmed];
                const result = translation ? source.replace(trimmed, translation) : source;
                if (node.nodeValue !== result)
                    node.nodeValue = result;
                originals.set(node, { source, translated: result });
            }
            let select = document.getElementById('interfaceLanguage');
            if (!select) {
                const holder = document.createElement('label');
                holder.dataset.noTranslate = 'true';
                holder.className = 'interface-language';
                holder.style.cssText = 'display:block;padding:8px 20px;text-align:end';
                holder.textContent = 'Language ';
                select = document.createElement('select');
                select.id = 'interfaceLanguage';
                select.setAttribute('aria-label', 'Interface language');
                holder.append(select);
                root.prepend(holder);
                select.onchange = () => choose(select.value, true).catch(e => alert(e.message));
            }
            const signature = available.map(l => l.locale).join(',');
            if (select.dataset.signature !== signature) {
                select.replaceChildren(...available.map(l => { const option = document.createElement('option'); option.value = l.locale; option.textContent = l.name; return option; }));
                select.dataset.signature = signature;
            }
            select.value = locale;
        }
        finally {
            busy = false;
        }
    }
    fetch('/v1/public/locales').then(r => r.json()).then(async (rows) => { available = rows; const saved = localStorage.getItem('ecc_locale') || 'en'; await choose(rows.some(l => l.locale === saved) ? saved : 'en'); new MutationObserver(() => { if (!busy)
        queueMicrotask(apply); }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true, characterData: true }); }).catch(() => { });
    window.eccChooseLanguage = choose;
})();
