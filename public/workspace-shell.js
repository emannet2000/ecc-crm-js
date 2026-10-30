// Generated from browser/workspace-shell.ts; edit the TypeScript source.
const $ = s => document.querySelector(s), app = $('#app'), API = '/v1', ST = ['INQUIRY', 'ASSESSMENT', 'DOCUMENTS_PENDING', 'PROPOSAL', 'CLIENT', 'LOST', 'DISQUALIFIED', 'WITHDRAWN', 'ARCHIVED'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tok = localStorage.tok, me = JSON.parse(localStorage.me || 'null');
async function api(p, o = {}) {
    const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: o.body && JSON.stringify(o.body) });
    if (r.status === 401 && tok) {
        logout();
        throw 0;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
        throw j.error || 'ERROR';
    return j;
}
function logout() { localStorage.removeItem('tok'); localStorage.removeItem('me'); tok = me = null; location.hash = '#/login'; }
const badge = s => `<span class="badge ${{ INQUIRY: 'b-inq', ASSESSMENT: 'b-doc', DOCUMENTS_PENDING: 'b-doc', PROPOSAL: 'b-prop', CLIENT: 'b-conv' }[s] || 'b-gray'}">${esc(s.replace('_', ' '))}</span>`;
const shell = h => `<div class="ph"><b>ECC CRM</b><span>${esc(me.full_name)} (${me.role}) · <a href="#" onclick="logout();return false" style="color:#fff">Logout</a></span></div>${workspaceNav()}<div class="pt" style="max-width:1200px">${h}</div>`;
const R = {
    async apply() { location.replace('/application.html'); },
    async login(mode = 'staff') {
        app.innerHTML = `<div class="pt" style="max-width:380px;margin-top:60px"><div class="card"><h1>${mode === 'client' ? 'Client sign in' : 'Staff / agent sign in'}</h1><form id="f"><label>Email</label><input class="f" name="email" placeholder="name@ecc.example"><label>Password</label><input class="f" type="password" name="password" autocomplete="current-password"><p><button class="btn p" style="width:100%">Sign in</button></p><div id="e" style="color:var(--bad)"></div></form><a href="#/apply">← Public form</a></div></div>`;
        $('#f').onsubmit = async (e) => { e.preventDefault(); try {
            const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
            await finishLogin(r);
        }
        catch (x) {
            $('#e').textContent = x;
        } };
    },
    async leads(q = '', clients = false) {
        const sp = new URLSearchParams(q);
        if (clients)
            sp.set('status', 'CLIENT');
        const listRoute = clients ? 'clients' : 'leads';
        const [d, users] = await Promise.all([api('/leads?' + sp), api('/directory')]);
        app.innerHTML = shell(`<div class="row"><h1>${clients ? 'Clients' : 'Leads'}</h1>${!clients && me.permission_level !== 'VIEWER' ? '<button class="btn p" id="newLead">Add lead</button>' : ''}</div><div class="bar"><select id="st" ${clients ? 'disabled' : ''}><option value="">All statuses</option>${(clients ? ['CLIENT'] : ST).map(s => `<option ${sp.get('status') == s ? 'selected' : ''}>${s}</option>`)}</select><select id="assignee"><option value="">All staff</option>${users.map(u => `<option value="${u.id}" ${String(u.id) === sp.get('assigned_to') ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}</select><input id="se" type="search" placeholder="Search name, email, ref…" value="${esc(sp.get('search') || '')}" style="flex:1"><button class="btn" id="go">Filter</button></div>
 <table><thead><tr><th>Ref</th><th>Name</th><th>Country</th><th>Purpose</th><th>Status</th><th>Assigned</th><th>Created</th></tr></thead><tbody>${d.rows.map(l => `<tr style="cursor:pointer" onclick="location.hash='#/lead/${l.id}'"><td class="mono">${l.reference_no}</td><td>${esc(l.full_name)}</td><td>${esc(l.country_of_interest)}</td><td>${l.application_type}</td><td>${badge(l.status)}</td><td>${esc(l.assignee || '—')}</td><td>${l.created_at.slice(0, 10)}</td></tr>`).join('') || `<tr><td colspan=7 style="text-align:center;padding:30px;color:var(--n6)">No ${clients ? 'clients' : 'leads'} found</td></tr>`}</tbody></table><div class="pg"><span>${d.total} total · page ${d.page}</span><div>${d.page > 1 ? '<button class="btn" id="previousPage">Previous</button>' : ''} ${d.page * 20 < d.total ? '<button class="btn" id="nextPage">Next</button>' : ''}</div></div>`);
        if ($('#newLead'))
            $('#newLead').onclick = () => newLeadDialog();
        $('#go').onclick = () => location.hash = '#/' + listRoute + '?' + new URLSearchParams({ status: $('#st').value, search: $('#se').value, assigned_to: $('#assignee').value });
        const page = step => { sp.set('page', d.page + step); location.hash = '#/' + listRoute + '?' + sp; };
        if ($('#previousPage'))
            $('#previousPage').onclick = () => page(-1);
        if ($('#nextPage'))
            $('#nextPage').onclick = () => page(1);
    },
    async lead(id) {
        const l = await api('/leads/' + id), i = ST.indexOf(l.status);
        app.innerHTML = shell(`<p><a href="#/${l.status === 'CLIENT' ? 'clients' : 'leads'}">← ${l.status === 'CLIENT' ? 'Clients' : 'Leads'}</a></p><div class="lh"><div class="row" style="margin:0"><div><h1>${esc(l.full_name)}</h1><div class="meta"><span class="mono">${l.reference_no}</span> · ${esc(l.country_of_interest)} · ${l.application_type} · ${esc(l.email)} · ${esc(l.phone || '')}</div></div>
 ${badge(l.status)}${l.status !== 'CLIENT' && !['ARCHIVED', 'LOST', 'DISQUALIFIED', 'WITHDRAWN'].includes(l.status) ? '<button class="btn p" onclick="showClientConversion()">Convert lead to client</button>' : ''}</div><div class="steps">${ST.slice(0, 5).map((s, k) => `<div class="${k < i ? 'd' : k == i ? 'c' : ''}">${s.replace('_', ' ')}</div>`).join('')}</div></div>
 <div class="g2" style="margin-top:16px"><div><div class="card"><h3>Notes</h3><textarea class="f" id="nt" rows="4">${esc(l.notes)}</textarea><p><button class="btn p" id="sn">Save Notes</button></p>${l.message ? `<div class="note">Client message: ${esc(l.message)}</div>` : ''}</div>
 <div class="card"><h3>Tasks <button class="btn" style="float:right" id="at">+ Add</button></h3>${l.tasks.map(t => `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--n2)"><input type="checkbox" ${t.status == 'DONE' ? 'checked' : ''} onchange="tg(${t.id},this.checked,${id})"><span style="${t.status == 'DONE' ? 'text-decoration:line-through;color:var(--n6)' : ''}">${esc(t.title)}</span><small style="margin-left:auto;color:var(--n6)">${esc(t.assignee || '')} ${t.due_date || ''}</small><button class="btn" onclick="editTask(${id},${t.id})">Edit</button></div>`).join('') || '<p style="color:var(--n6)">No tasks</p>'}</div></div>
 <div class="card"><h3>History</h3><div class="tl">${l.history.map(h => `<div><b>${h.action} ${h.entity_type}</b> ${esc(h.new_values || '')}<small>${esc(h.changed_by)} · ${h.at}</small></div>`).join('')}</div></div></div>`);
        await renderWorkflow(id);
        if (typeof renderReconciledCaseHistory === 'function')
            await renderReconciledCaseHistory(id);
        $('#sn').onclick = async () => { await api('/leads/' + id, { method: 'PATCH', body: { notes: $('#nt').value } }); R.lead(id); };
        $('#at').onclick = () => editTask(id, null);
        if (me.permission_level === 'VIEWER') {
            document.querySelectorAll('#nt,#sn,#at,input[type=checkbox],button[onclick^="editTask"]').forEach(el => el.disabled = true);
        }
    }
};
window.tg = async (t, c, id) => { await api('/tasks/' + t, { method: 'PATCH', body: { status: c ? 'DONE' : 'PENDING' } }); R.lead(id); };
async function route() {
    const [h, q = ''] = (location.hash || '#/apply').slice(2).split('?'), [r, a] = h.split('/');
    try {
        portalToken = null;
        if (r === 'portal')
            return await renderPortal(a);
        if (r === 'portals')
            return renderPortalLanding();
        if (r === 'apply')
            return R.apply();
        if (r === 'login')
            return R.login();
        if (r === 'client-login')
            return R.login('client');
        if (r === 'reset')
            return renderPasswordReset(a);
        if (r === 'verify')
            return renderVerifyEmail(a);
        if (r === 'payment-return')
            return renderPaymentReturn();
        if (r === 'client') {
            if (!tok)
                return location.hash = '#/client-login';
            return await renderPortal(null);
        }
        if (!tok)
            return location.hash = '#/login';
        if (['advanced', 'business', 'growth', 'system', 'requirements', 'admin', 'agent', 'access', 'dashboard', 'calendar', 'reports', 'accounts', 'pricing', 'agreements', 'notifications', 'settings'].includes(r))
            return await renderWorkspace(r, q);
        if (r === 'clients')
            return await R.leads(q, true);
        if (r === 'lead')
            return await R.lead(a);
        return await R.leads(q);
    }
    catch (e) {
        if (e)
            app.innerHTML = `<div class="pt"><div class="note">Error: ${esc(e)}</div></div>`;
    }
}
addEventListener('hashchange', route);
