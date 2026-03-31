import { supabase, initializeApplication, showNotification } from './core-app.js';

const STORAGE_KEY = 'makarigad_operator_daily_entries';

async function fetchEntries() {
    try {
        if (navigator.onLine) {
            const { data, error } = await supabase
                .from('operator_daily_logs')
                .select('*')
                .order('date', { ascending: false })
                .limit(50);
            if (!error && data) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                return data;
            }
        }
    } catch (e) {
        console.warn("Could not fetch from Supabase, using local cache.");
    }
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

async function renderEntries() {
    const tbody = document.getElementById('daily-table-body');
    const countEl = document.getElementById('entry-count');
    if (!tbody || !countEl) return;

    const entries = await fetchEntries();
    countEl.textContent = `${entries.length} records`;

    tbody.innerHTML = entries.map((item) => `
        <tr class="border-t border-slate-100 align-top hover:bg-slate-50 transition">
            <td class="px-2 py-3 font-bold text-indigo-900">${item.date || '-'}</td>
            <td class="px-2 py-3"><span class="px-2 py-1 bg-slate-100 rounded text-[10px] font-black">${item.shift || '-'}</span></td>
            <td class="px-2 py-3 font-medium text-slate-700">${item.operator || '-'}</td>
            <td class="px-2 py-3 text-slate-600 leading-relaxed">${item.task || '-'}</td>
            <td class="px-2 py-3 text-slate-500 italic text-[11px]">${item.remark || '-'}</td>
        </tr>
    `).join('');
}

function bindForm() {
    const form = document.getElementById('daily-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;

        const payload = {
            date: document.getElementById('entry-date').value,
            shift: document.getElementById('entry-shift').value,
            operator: document.getElementById('entry-operator').value.trim(),
            weather: document.getElementById('entry-weather').value.trim(),
            task: document.getElementById('entry-task').value.trim(),
            remark: document.getElementById('entry-remark').value.trim(),
            note: document.getElementById('entry-note').value.trim(),
            created_at: new Date().toISOString(),
            operator_email: window.currentUser?.email || null
        };

        try {
            if (navigator.onLine) {
                const { error } = await supabase.from('operator_daily_logs').insert([payload]);
                if (error) throw error;
                showNotification('✅ Entry synced to cloud successfully.');
            } else {
                // Handle offline sync if needed, but for now just local save
                const entries = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
                entries.unshift(payload);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
                showNotification('Saved locally (Offline). Will sync later.');
            }
            form.reset();
            document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
            await renderEntries();
        } catch (e) {
            showNotification('Error saving: ' + e.message, true);
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

function bindExport() {
    const btn = document.getElementById('export-daily-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const entries = getEntries();
        const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `operator-daily-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    });
}

async function init() {
    await initializeApplication(true);
    const dateInput = document.getElementById('entry-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    bindForm();
    bindExport();
    renderEntries();
}

init();
