// Generated from browser/growth.ts; edit the TypeScript source.
async function renderGrowth() {
    const [directory, automation] = await Promise.all([api('/directory'), api('/admin/automation')]);
    const staff = directory.filter(u => u.role !== 'client').map(u => ({ value: u.id, label: u.full_name }));
    app.innerHTML = shell(`<h1>Import & automation</h1>
 <section class="card"><h2>Import leads</h2><p>Upload CSV or a single-sheet Excel (.xlsx) workbook. Preview validates every row. Existing or repeated email/phone matches are skipped. Maximum 1,000 rows.</p>
 <form id="importForm"><label>CSV / Excel file</label><input class="f" id="csvFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required><div id="columnMapping"></div>${selectField('Assign imported leads to', 'assigned_to', staff)}<button class="btn" type="submit">Preview import</button></form><div id="importPreview"></div></section>
 <section class="card"><h2>Merge duplicate inquiries</h2><p>Select the duplicate source and the record to keep. Open tasks and messages move to the target; the source is archived with its original history. Sources with signed profiles, assessments, documents, billing or client accounts are protected.</p><form id="mergeForm">${field('Duplicate source lead ID', 'source_id', '', 'number')}${field('Keep target lead ID', 'target_id', '', 'number')}<button class="btn" type="submit">Review merge</button></form><div id="mergePreview"></div></section>
 <section class="card"><h2>Workflow rules</h2><p>Enabled rules run every minute while the server is running. Each rule creates one follow-up per matching lead and can assign the lead to selected staff. Dry run shows pending matches.</p>${table(['Rule', 'Stage', 'Country', 'Task', 'Enabled', ''], automation.rules.map(r => [esc(r.name), esc(r.stage), esc(r.country || 'All'), esc(r.title), r.enabled ? 'Yes' : 'No', `<button class="btn" onclick="toggleAutomation(${r.id},${!r.enabled})">${r.enabled ? 'Disable' : 'Enable'}</button>`]))}
 <form id="automationForm">${field('Rule name', 'name')}${selectField('Stage', 'stage', ['INQUIRY', 'ASSESSMENT', 'DOCUMENTS_PENDING', 'PROPOSAL', 'CLIENT'])}${selectField('Country', 'country', [{ value: '', label: 'All countries' }, 'Spain', 'Portugal', 'Canada', 'Australia', 'New Zealand', 'Malta'])}${field('Follow-up task title', 'title')}${field('Due in days', 'days', '1', 'number')}${selectField('Assign lead and task to', 'assignee_id', [{ value: '', label: 'Keep current assignee' }, ...staff])}<label><input type="checkbox" name="overdue_only"> Only leads with overdue tasks</label>${submit('Add rule')}</form>
 <button class="btn" id="dryRun">Dry run</button> <button class="btn" id="runAutomation">Run now</button><div id="automationResult" aria-live="polite"></div></section>`);
    let csv = '', mapping = {}, previewBody = null;
    $('#csvFile').onchange = async (e) => { try {
        const file = e.target.files[0];
        if (!file)
            return;
        if (file.size > 2e6)
            throw Error('CSV maximum 2 MB');
        let excelHeaders = null;
        if (file.name.toLowerCase().endsWith('.xlsx')) {
            const data = await importFileBase64(file), parsed = await action('/admin/imports/xlsx', { data });
            csv = parsed.csv;
            excelHeaders = parsed.headers;
        }
        else
            csv = await file.text();
        const headers = excelHeaders || (await action('/admin/imports/headers', { csv })).headers;
        const fields = ['full_name', 'email', 'phone', 'country_of_interest', 'application_type', 'origin_country'];
        $('#columnMapping').innerHTML = fields.map(k => selectField(k, k, [{ value: '', label: 'Unmapped' }, ...headers], headers.includes(k) ? k : '')).join('');
        $('#importPreview').textContent = '';
        previewBody = null;
    }
    catch (e) {
        alert(errorText(e));
    } };
    $('#importForm').onsubmit = async (e) => { e.preventDefault(); try {
        mapping = {};
        for (const k of ['full_name', 'email', 'phone', 'country_of_interest', 'application_type', 'origin_country'])
            mapping[k] = e.target.elements[k]?.value || '';
        previewBody = { csv, mapping, assigned_to: Number(e.target.elements.assigned_to.value), request_id: crypto.randomUUID() };
        const p = await action('/admin/imports/preview', previewBody);
        $('#importPreview').innerHTML = table(['Row', 'Name', 'Email', 'Result'], p.rows.map(r => [r.row, esc(r.lead.full_name), esc(r.lead.email), esc(r.errors.join('; ') || (r.duplicates.length || r.batch_duplicate ? 'Duplicate — will skip' : 'Ready'))])) + `<button class="btn p" id="commitImport" ${p.rows.some(r => r.errors.length) ? 'disabled' : ''}>Import valid nonduplicate rows</button>`;
        $('#commitImport').onclick = async () => { try {
            const result = await action('/admin/imports/commit', previewBody);
            $('#importPreview').textContent = `Imported ${result.created.length}; skipped ${result.skipped}.`;
        }
        catch (e) {
            alert(errorText(e));
        } };
    }
    catch (e) {
        alert(errorText(e));
    } };
    $('#mergeForm').onsubmit = async (e) => { e.preventDefault(); try {
        const body = { source_id: Number(e.target.elements.source_id.value), target_id: Number(e.target.elements.target_id.value) }, p = await action('/admin/merges/preview', body);
        $('#mergePreview').innerHTML = `<p>Archive ${esc(p.source.reference_no)} (${esc(p.source.full_name)}) into ${esc(p.target.reference_no)} (${esc(p.target.full_name)}).</p><p>Move ${p.counts.tasks} tasks and ${p.counts.messages} messages.</p>${p.blockers.length ? `<p>Merge blocked: ${esc(p.blockers.join(', '))}</p>` : `<label>Reason</label><input class="f" id="mergeReason"><button class="btn" id="commitMerge">Confirm reviewed merge</button>`}`;
        if (!p.blockers.length)
            $('#commitMerge').onclick = async () => { try {
                await action('/admin/merges/commit', { ...body, fingerprint: p.fingerprint, reason: $('#mergeReason').value });
                $('#mergePreview').textContent = 'Merge complete. Source history is retained.';
            }
            catch (e) {
                alert(errorText(e));
            } };
    }
    catch (e) {
        alert(errorText(e));
    } };
    bindForm('automationForm', async (b) => { await action('/admin/automation', { ...b, days: Number(b.days), assignee_id: b.assignee_id ? Number(b.assignee_id) : null, overdue_only: $('#automationForm').elements.overdue_only.checked }); await renderGrowth(); });
    const run = async (dry) => { try {
        const r = await action('/admin/automation/run', { dry_run: dry });
        $('#automationResult').innerHTML = table(['Rule', dry ? 'Matching leads' : 'Processed leads'], r.results.map(x => [esc(x.name), x.leads.length]));
    }
    catch (e) {
        alert(errorText(e));
    } };
    $('#dryRun').onclick = () => run(true);
    $('#runAutomation').onclick = () => run(false);
}
async function toggleAutomation(id, enabled) { try {
    await api('/admin/automation/' + id, { method: 'PATCH', body: { enabled } });
    await renderGrowth();
}
catch (e) {
    alert(errorText(e));
} }
function importFileBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('FILE_READ_FAILED')); reader.readAsDataURL(file); }); }
