import { initializeApplication, showNotification } from './core-app.js';

const STORAGE_KEY = 'makarigad_operator_daily_entries';

function getEntries() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
        return [];
    }
}

function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function renderEntries() {
    const tbody = document.getElementById('daily-table-body');
    const countEl = document.getElementById('entry-count');
    if (!tbody || !countEl) return;

    const entries = getEntries().sort((a, b) => (a.date < b.date ? 1 : -1));
    countEl.textContent = `${entries.length} records`;

    tbody.innerHTML = entries.map((item) => `
        <tr class="border-t border-slate-100 align-top">
            <td class="px-2 py-2">${item.date || '-'}</td>
            <td class="px-2 py-2">${item.shift || '-'}</td>
            <td class="px-2 py-2">${item.operator || '-'}</td>
            <td class="px-2 py-2">${item.task || '-'}</td>
            <td class="px-2 py-2">${item.remark || '-'}</td>
        </tr>
    `).join('');
}

function bindForm() {
    const form = document.getElementById('daily-form');
    if (!form) return;

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const entries = getEntries();
        const payload = {
            id: `${Date.now()}`,
            date: document.getElementById('entry-date').value,
            shift: document.getElementById('entry-shift').value,
            operator: document.getElementById('entry-operator').value.trim(),
            weather: document.getElementById('entry-weather').value.trim(),
            task: document.getElementById('entry-task').value.trim(),
            remark: document.getElementById('entry-remark').value.trim(),
            note: document.getElementById('entry-note').value.trim(),
            created_at: new Date().toISOString()
        };

        entries.push(payload);
        saveEntries(entries);
        form.reset();
        document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
        renderEntries();
        showNotification('Daily operator entry saved.');
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
