// Generated from browser/release.ts; edit the TypeScript source.
function portalHeaders() { const headers = { 'Content-Type': 'application/json', ...(portalToken ? { 'X-Portal-Token': portalToken } : tok ? { Authorization: 'Bearer ' + tok } : {}) }; if (!portalToken) {
    const selected = new URLSearchParams(location.hash.split('?')[1] || '').get('application');
    if (selected)
        headers['X-Application-Id'] = selected;
} return headers; }
async function finishLogin(r) { if (r.verification_required) {
    app.innerHTML = '<main class="pt"><div class="card"><h1>Verify your email</h1><p>A verification email has been queued. Open its private link to confirm your email, then sign in again.</p><a href="#/client-login">Back to client sign in</a></div></main>';
    return;
} if (r.mfa_required) {
    app.innerHTML = `<main class="pt"><div class="card"><h1>Authenticator verification</h1>${r.locked ? '<p>Too many attempts. Wait five minutes before signing in again.</p>' : `<form id="mfaLogin">${field('Six-digit authenticator code or recovery code', 'code')}${submit('Verify')}</form>`}<p><a href="#/login">Back to sign in</a></p></div></main>`;
    bindForm('mfaLogin', async (b) => finishLogin(await action('/auth/mfa/login', { challenge: r.challenge, code: b.code })));
    return;
} tok = r.token; me = r.user; localStorage.tok = tok; localStorage.me = JSON.stringify(me); location.hash = '#/' + (me.portal_role === 'client' ? 'client' : me.portal_role === 'admin' ? 'admin' : 'agent'); }
async function renderVerifyEmail(token) { app.innerHTML = `<main class="pt"><div class="card"><h1>Confirm email address</h1><form id="verifyEmail">${submit('Confirm my email')}</form><p><a href="#/login">Sign in</a></p></div></main>`; bindForm('verifyEmail', async () => { await action('/auth/verification/confirm', { token }); app.innerHTML = '<main class="pt"><h1>Email verified</h1><p><a href="#/login">Sign in to ECC</a></p></main>'; }); }
function signaturePad(canvas, upload) { const ctx = canvas.getContext('2d'); let drawing = false, data = '', epoch = 0; const rect = () => canvas.getBoundingClientRect(), clear = () => { epoch++; data = ''; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }, save = () => data = canvas.toDataURL('image/png'); function fit() { const r = rect(); if (!r.width)
    return; const old = data, version = ++epoch, ratio = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#07172b'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height); if (old) {
    const img = new Image();
    img.onload = () => { if (version === epoch)
        ctx.drawImage(img, 0, 0, r.width, r.height); };
    img.src = old;
} } fit(); const point = e => ({ x: e.clientX - rect().left, y: e.clientY - rect().top }); canvas.onpointerdown = e => { e.preventDefault(); drawing = true; canvas.setPointerCapture(e.pointerId); const p = point(e); ctx.beginPath(); ctx.fillStyle = '#07172b'; ctx.arc(p.x, p.y, 1.2, 0, 2 * Math.PI); ctx.fill(); ctx.beginPath(); ctx.moveTo(p.x, p.y); }; canvas.onpointermove = e => { if (drawing) {
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
} }; canvas.onpointerup = canvas.onpointercancel = () => { if (drawing) {
    drawing = false;
    save();
} }; if (upload)
    upload.onchange = e => { const file = e.target.files[0]; if (!file)
        return; if (file.size > 1048576 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        return alert('Use a signature image up to 1 MB.'); const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { clear(); const r = rect(), scale = Math.min(r.width / image.width, r.height / image.height); ctx.drawImage(image, (r.width - image.width * scale) / 2, (r.height - image.height * scale) / 2, image.width * scale, image.height * scale); save(); }; image.src = reader.result; }; reader.readAsDataURL(file); }; return { clear, data: () => { if (drawing)
        save(); return data; } }; }
function signatureControls(d, p, staff) { const signed = (d.electronic_signatures || []).filter(s => s.proposal_id === p.id), latest = signed[0]; return `${latest ? `<div class="note">Electronic signature: ${esc(latest.status)} · ${esc(latest.signer_name)} · ${esc(latest.signed_at)}<p>${esc(latest.review_notes || '')}</p><button class="btn" onclick="downloadSignedAgreement(${d.id},${latest.id})">Download signed agreement record</button>${staff && p.status === 'APPROVED' && me.permission_level !== 'VIEWER' ? ` <button class="btn" onclick="reviewElectronicSignature(${d.id},${latest.id},'ACCEPTED')">Accept signature</button> <button class="btn" onclick="reviewElectronicSignature(${d.id},${latest.id},'REJECTED')">Reject signature</button>` : ''}</div>` : ''}${!staff && p.status === 'APPROVED' && p.customer_status === 'ACCEPTED' && (!latest || latest.status === 'REJECTED') ? `<p><button class="btn p" onclick="signAgreement(${p.id})">Sign this agreement electronically</button></p>` : ''}`; }
function signAgreement(id) { let pad; const dialog = dialogForm('Sign proposal and agreement', `<p>Review the proposal and agreement before signing. This signature is bound to its exact revision.</p>${field('Full legal name', 'name', workflowData.full_name)}<canvas id="agreementSignature" class="signature-pad" aria-label="Agreement signature" style="width:100%;height:180px;touch-action:none;border:1px solid #ccc"></canvas><p><button class="btn" type="button" id="clearAgreementSignature">Clear signature</button></p><label>Or upload signature image<input type="file" id="agreementSignatureUpload" accept="image/png,image/jpeg,image/webp"></label><label class="check-label"><input type="checkbox" name="consent" required>I have read and agree to this proposal and agreement and intend this electronic signature to sign this exact revision.</label>`, async (b) => { if (!pad.data())
    throw Error('Draw or upload your signature'); await portalApi(`/proposals/${id}/sign`, { method: 'POST', body: { name: b.name, consent: b.consent === 'on', signature_data: pad.data() } }); await renderPortal(portalToken); }); pad = signaturePad(dialog.querySelector('canvas'), dialog.querySelector('#agreementSignatureUpload')); dialog.querySelector('#clearAgreementSignature').onclick = pad.clear; }
async function downloadSignedAgreement(id, signature) { try {
    const client = portalToken || me?.portal_role === 'client', r = await fetch(client ? `/v1/portal/signatures/${signature}` : `/v1/workflow/${id}/signatures/${signature}`, { headers: client ? portalHeaders() : { Authorization: 'Bearer ' + tok } });
    if (!r.ok)
        throw Error('DOWNLOAD_FAILED');
    const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
    a.href = url;
    a.download = 'ecc-signed-agreement-' + signature + '.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
catch (e) {
    alert(errorText(e));
} }
async function reviewElectronicSignature(id, signature, status) { const notes = prompt(status === 'REJECTED' ? 'Reason for rejection' : 'Review notes (optional)'); if (notes !== null)
    await workflowAction(id, `signatures/${signature}/review`, { status, notes }); }
async function enhanceClientPortal(d) { try {
    const [apps, payment] = await Promise.all([portalApi('/applications'), portalApi('/payment-options')]);
    if (!portalToken && Array.isArray(apps) && apps.length > 1) {
        const first = document.querySelector('main h1');
        first.insertAdjacentHTML('afterend', selectField('Choose your application', 'active_application', apps.filter(a => ['CLIENT', 'PROPOSAL'].includes(a.status)).map(a => ({ value: a.id, label: a.reference_no + ' · ' + a.country_of_interest + ' · ' + a.application_type })), d.id));
        document.querySelector('select[name=active_application]').onchange = e => location.hash = '#/client?application=' + e.target.value;
    }
    if (payment?.configured)
        for (const c of d.charges.filter(c => c.status !== 'VOID' && c.balance_cents > 0)) {
            const card = document.querySelector(`[data-invoice-id="${c.id}"]`);
            if (card)
                card.insertAdjacentHTML('beforeend', `<p><button class="btn p" onclick="payInvoice(${c.id})">Pay outstanding balance online</button>${c.installments.filter(i => i.balance_cents > 0).map(i => ` <button class="btn" onclick="payInvoice(${c.id},${i.id})">Pay ${esc(i.label)}</button>`).join('')}</p>`);
        }
}
catch { } }
async function payInvoice(id, installment) { try {
    const r = await portalApi(`/invoices/${id}/checkout`, { method: 'POST', body: { installment_id: installment || null } });
    location.assign(r.url);
}
catch (e) {
    alert(errorText(e));
} }
function renderPaymentReturn() { const result = new URLSearchParams(location.hash.split('?')[1] || '').get('result'); app.innerHTML = `<main class="pt"><h1>${result === 'success' ? 'Payment submitted' : 'Payment cancelled'}</h1><p>${result === 'success' ? 'Your portal will update after the payment provider confirms the result.' : 'No payment was confirmed by this page.'}</p><p><a href="#/client">Open client portal</a>, or return using your private invitation link.</p></main>`; }
function refundOnline(id, payment) { const request = crypto.randomUUID(); dialogForm('Refund original payment method', `${field('Refund amount', 'amount', '', 'number')}${area('Reason', 'reason')}<p>This requests a real refund through the configured payment provider.</p>`, async (b) => { await action(`/workflow/${id}/payments/${payment}/provider-refund`, { ...b, request_id: request }); await R.lead(id); }); $('#workspaceDialogForm').elements.amount.step = '0.01'; }
async function enhanceStaffRecord(d) { try {
    const [template, findings] = await Promise.all([api(`/workflow/${d.id}/requirement-template`), api('/pricing/source-findings')]);
    const relevant = (findings || []).filter(f => f.country === d.country_of_interest && ['ALL', d.application_type].includes(f.purpose));
    if (relevant.length && $('#proposalForm'))
        $('#proposalForm').insertAdjacentHTML('afterbegin', `<div class="note"><h3>Source findings to review</h3>${relevant.map(f => `<p>${esc(f.finding)} <a href="${esc(f.source)}" target="_blank" rel="noopener">Official source</a> · checked ${esc(f.checked_on)}</p>`).join('')}<p>Review the current rate version and applicant details before issuing a quote.</p></div>`);
    const form = $('#requirementsForm');
    if (template && form) {
        form.insertAdjacentHTML('beforeend', `<p><button class="btn" type="button" id="loadRequirementTemplate">Load approved country/pathway checklist</button></p><p>Source reviewed ${esc(template.verified_on)} · review due ${esc(template.review_due)}</p>`);
        $('#loadRequirementTemplate').onclick = () => form.elements.titles.value = template.items.join('\n');
    }
}
catch { } }
async function renderSecurityPanel() { const state = await api('/auth/security'); document.querySelector('.pt').insertAdjacentHTML('beforeend', `<div class="card"><h3>Account security</h3><p>Email: ${esc(state.email)} · ${state.email_verified ? 'Verified' : 'Not verified'}</p>${!state.email_verified ? '<button class="btn" id="requestVerification">Send verification email</button>' : ''}<p>Authenticator MFA: ${state.mfa_enabled ? 'Enabled · ' + state.recovery_codes_remaining + ' recovery codes remaining' : 'Not enabled'}</p>${state.mfa_enabled ? `<form id="mfaDisable">${field('Current password', 'password', '', 'password')}${field('Fresh authenticator or recovery code', 'code')}${submit('Disable MFA and sign out')}</form>` : `<form id="mfaSetup">${field('Current password', 'password', '', 'password')}${submit('Set up authenticator MFA')}</form><div id="mfaEnrollment"></div>`}</div>`); if ($('#requestVerification'))
    $('#requestVerification').onclick = async () => { await action('/auth/verification/request', {}); alert('Verification email queued.'); }; bindForm('mfaDisable', async (b) => { await action('/auth/mfa/disable', b); logout(); }); bindForm('mfaSetup', async (b) => { const r = await action('/auth/mfa/setup', b); $('#mfaEnrollment').innerHTML = `<p>Add this secret to your authenticator app. Keep it private:</p><code>${esc(r.secret)}</code><p><a href="${esc(r.uri)}">Open authenticator app</a></p><form id="mfaEnable">${field('Six-digit authenticator code', 'code')}${submit('Enable MFA')}</form>`; bindForm('mfaEnable', async (b) => { const done = await action('/auth/mfa/enable', b); $('#mfaEnrollment').innerHTML = `<h3>Save your recovery codes now</h3><p>Each code works once. They will not be shown again.</p><pre>${done.recovery_codes.map(esc).join('\n')}</pre><button class="btn p" id="finishMfa">I saved the codes — sign in again</button>`; $('#finishMfa').onclick = logout; }); }); }
async function renderSystem() { const [d, payment] = await Promise.all([api('/admin/system'), api('/admin/payment-status')]); app.innerHTML = shell(`<h1>Operations and readiness</h1><div class="card"><h3>Production configuration</h3>${d.configuration_issues.length ? `<ul>${d.configuration_issues.map(x => `<li>${esc(errorText(x))}</li>`).join('')}</ul>` : '<p>Startup configuration checks passed.</p>'}<p>Email configured: ${d.email_configured ? 'Yes' : 'No'} · Online payments configured: ${d.payments_configured ? 'Yes' : 'No'} · Approved agreement templates: ${d.approved_agreements}</p><p>These checks do not confirm live email receipt, a live payment, DNS, TLS reachability, or legal approval of wording.</p></div><div class="card"><h3>Backups and restore exercises</h3><p>Encryption: ${d.backups.encrypted ? 'Enabled' : 'Not configured'} · Interval: ${d.backups.interval_minutes} minutes</p><button class="btn" id="createBackup">Create backup now</button>${table(['Backup', ''], d.backups.files.map(name => [esc(name), `<button class="btn" data-verify-backup="${esc(name)}">Verify by restoring a temporary copy</button>`]))}<div id="restoreResult"></div></div><div class="card"><h3>Live email delivery check</h3><form id="emailDeliveryTest">${field('Recipient', 'recipient', '', 'email')}${submit('Queue delivery check')}</form><p>Confirm receipt in that inbox; provider acceptance alone is not delivery verification.</p></div><div class="card"><h3>Online payment reconciliation</h3>${table(['Invoice', 'Application', 'Amount', 'State', 'Issue'], (payment?.attempts || []).map(p => [p.charge_id, `<a href="#/lead/${p.lead_id}">${p.lead_id}</a>`, amount(p.currency, p.amount_cents), esc(p.state), esc(p.error || '')]))}${table(['Refund request', 'Payment', 'State', 'Issue'], (payment?.refunds || []).map(r => [esc(r.id), r.payment_id, esc(r.state), esc(r.error || '')]))}</div><div class="card"><h3>Recent errors</h3>${table(['Time', 'Code', 'Request', 'Route'], d.errors.map(e => [esc(e.created_at), esc(e.code), esc(e.request_id || ''), esc(e.route || '')]))}</div>`); $('#createBackup').onclick = async () => { await action('/admin/system/backups', {}); await renderSystem(); }; document.querySelectorAll('[data-verify-backup]').forEach(button => button.onclick = async () => { try {
    const r = await action('/admin/system/backups/verify', { name: button.dataset.verifyBackup });
    $('#restoreResult').textContent = 'Restore integrity check passed: ' + r.tables + ' tables.';
}
catch (e) {
    alert(errorText(e));
} }); bindForm('emailDeliveryTest', async (b) => { await action('/admin/system/email-test', b); alert('Delivery check queued. Confirm receipt in the recipient inbox.'); }); }
async function renderRequirements() { const [rows, reviews, catalog] = await Promise.all([api('/requirement-templates'), api('/admin/pricing-reviews'), api('/public/catalog')]); app.innerHTML = shell(`<h1>Country requirements and rate reviews</h1><div class="card"><h3>Document requirement templates</h3>${table(['Country', 'Purpose', 'Verified', 'Review due', 'Status', ''], rows.map(t => [esc(t.country), esc(t.purpose), esc(t.verified_on), esc(t.review_due), esc(t.status), t.status === 'DRAFT' ? `<button class="btn" onclick="approveRequirements(${t.id})">Confirm source and approve</button>` : '']))}<form id="requirementsCatalog">${selectField('Country', 'country', catalog.countries)}${selectField('Purpose', 'purpose', ['TOURIST', 'STUDY', 'WORK', 'RESIDENCY'])}${area('Document requirements (one per line)', 'items')}${field('Official source URL', 'source_url', '', 'url')}${field('Source verified on', 'verified_on', today(), 'date')}${field('Next review due', 'review_due', '', 'date')}${submit('Save requirement draft')}</form></div><div class="card"><h3>Pricing source reviews</h3>${table(['Version', 'Source', 'Verified', 'Review due', 'Notes'], reviews.map(r => [esc(r.version), esc(r.source_url), esc(r.verified_on), esc(r.review_due), esc(r.notes)]))}<form id="priceReview">${field('Official fee source URL', 'source_url', '', 'url')}${area('Verified fees, currencies, conversion assumptions and discrepancies', 'notes')}${field('Verified on', 'verified_on', today(), 'date')}${field('Review due', 'review_due', '', 'date')}<label class="check-label"><input type="checkbox" name="confirm_verified" required>I checked this source and the relevant pricing assumptions.</label>${submit('Record review of active rate version')}</form></div>`); bindForm('requirementsCatalog', async (b) => { await action('/admin/requirement-templates', { ...b, items: b.items.split('\n').filter(x => x.trim()) }); await renderRequirements(); }); bindForm('priceReview', async (b) => { await action('/admin/pricing-reviews', { ...b, confirm_verified: b.confirm_verified === 'on' }); await renderRequirements(); }); }
async function approveRequirements(id) { if (confirm('Confirm that you checked the official source and the listed requirements for this country and pathway.')) {
    await action(`/admin/requirement-templates/${id}/approve`, { confirm_verified: true });
    await renderRequirements();
} }
