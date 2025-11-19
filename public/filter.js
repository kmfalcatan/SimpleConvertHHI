// DOM Elements
const filterForm = document.getElementById('filterForm');
const searchBtn = document.getElementById('searchBtn');
const clearBtn = document.getElementById('clearBtn');
const loading = document.getElementById('loading');
const resultsSection = document.getElementById('resultsSection');
const results = document.getElementById('results');
const resultsCount = document.getElementById('resultsCount');
const noResults = document.getElementById('noResults');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');

let currentResults = [];

// Event Listeners
filterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await searchCases();
});

clearBtn.addEventListener('click', () => {
    filterForm.reset();
    resultsSection.classList.add('hidden');
    noResults.classList.add('hidden');
    currentResults = [];
});

exportCsvBtn.addEventListener('click', () => exportToCSV(currentResults));
exportJsonBtn.addEventListener('click', () => exportToJSON(currentResults));

// Formatting Helpers
function formatKey(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(value) {
    if (!value && value !== 0 && value !== false) return 'N/A';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
        return new Date(value).toLocaleDateString();
    }
    return value;
}

function shouldHideValue(value) {
    if (!value) return true;
    if (typeof value === 'string' && value.toLowerCase().includes('csv import')) return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return true;
    return false;
}

// Render Helpers
function renderArrayField(items, key) {
    if (!items?.length) return '<ul class="ml-4 list-disc"><li>N/A</li></ul>';
    
    const mapped = items.map(item => {
        if (typeof item === 'object' && item !== null) {
            const fieldMap = { documents: 'template_type', conditions: 'name', information: 'name', tags: 'name' };
            return item[fieldMap[key]] || JSON.stringify(item);
        }
        return item;
    }).filter(v => v && !String(v).toLowerCase().includes('csv import'));

    return `<ul class="ml-4 list-disc space-y-1">${mapped.map(v => `<li>${v}</li>`).join('')}</ul>`;
}

function renderObjectField(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 5) return 'N/A';
    
    return `<ul class="ml-4 list-disc space-y-1">${Object.entries(obj).map(([k, v]) => {
        if (typeof v === 'object' && v !== null) {
            if (Array.isArray(v)) {
                const items = v.map(item => 
                    typeof item === 'object' && item !== null ? renderObjectField(item, depth + 1) : (item || 'N/A')
                ).filter(item => item !== 'N/A' && item !== false).join('<br>');
                return items ? `<li><strong>${formatKey(k)}:</strong><br>${items}</li>` : '';
            }
            return `<li><strong>${formatKey(k)}:</strong><br>${renderObjectField(v, depth + 1)}</li>`;
        }
        return `<li><strong>${formatKey(k)}:</strong> ${v !== null && v !== false ? v : 'N/A'}</li>`;
    }).filter(Boolean).join('')}</ul>`;
}

// Date Parsing Helper
function parseDate(dateString) {
    if (!dateString) return null;
    const [datePart, timePart] = dateString.split(" ");
    const [year, month, day] = datePart.split("-");
    const [hour, minute, second] = (timePart || "00:00:00").split(":");
    return new Date(year, month - 1, day, hour, minute, second);
}

// Search & Filter
async function searchCases() {
    const inputs = {
        litigationId: document.getElementById('litigationId').value.trim(),
        statusId: document.getElementById('statusId').value.trim(),
        firstName: document.getElementById('firstName').value.trim(),
        lastName: document.getElementById('lastName').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        dateFrom: document.getElementById('dateFrom').value,
        dateTo: document.getElementById('dateTo').value,
        tags: document.getElementById('tags').value.trim(),
        limit: document.getElementById('limit').value
    };

    const params = {};
    if (inputs.litigationId) params.litigationId = inputs.litigationId;
    if (inputs.statusId) params.statusId = inputs.statusId;
    if (inputs.firstName) params.firstName = inputs.firstName;
    if (inputs.lastName) params.lastName = inputs.lastName;
    if (inputs.email) params.emailAddress = inputs.email;
    if (inputs.phone) params.phoneNumber = inputs.phone;
    if (inputs.dateFrom) params.createdAtStart = inputs.dateFrom;
    if (inputs.dateTo) params.createdAtEnd = inputs.dateTo;
    if (inputs.tags) params.tag = inputs.tags;
    if (inputs.limit) params.limit = inputs.limit;

    if (!Object.keys(params).some(k => k !== 'limit')) {
        showNotification('Please enter at least one search criteria', 'error');
        return;
    }

    searchBtn.disabled = true;
    loading.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    noResults.classList.add('hidden');

    try {
        const response = await fetch(`/cases?${new URLSearchParams(params)}`);
        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        currentResults = data.cases || [];

        // Client-side filtering
        currentResults = applyClientFilters(currentResults, inputs);

        if (currentResults.length === 0) {
            noResults.classList.remove('hidden');
        } else {
            displayResults(currentResults);
            resultsSection.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Search error:', error);
        showNotification('Error: ' + error.message, 'error');
    } finally {
        searchBtn.disabled = false;
        loading.classList.add('hidden');
    }
}

function applyClientFilters(cases, inputs) {
    return cases.filter(c => {
        if (inputs.firstName && !c.fname?.toLowerCase().includes(inputs.firstName.toLowerCase()) && 
            !c.fname_injured?.toLowerCase().includes(inputs.firstName.toLowerCase())) return false;
        
        if (inputs.lastName && !c.lname?.toLowerCase().includes(inputs.lastName.toLowerCase()) && 
            !c.lname_injured?.toLowerCase().includes(inputs.lastName.toLowerCase())) return false;
        
        if (inputs.email && c.email?.toLowerCase() !== inputs.email.toLowerCase()) return false;
        
        if (inputs.phone && !c.phone?.replace(/\D/g, '').includes(inputs.phone.replace(/\D/g, ''))) return false;
        
        if (inputs.litigationId && c.litigation_id != inputs.litigationId) return false;
        
        if (inputs.statusId && c.status_id != inputs.statusId) return false;
        
        if (inputs.dateFrom || inputs.dateTo) {
            const caseDate = parseDate(c.created_date);
            if (!caseDate) return false;
            
            if (inputs.dateFrom) {
                const fromDate = new Date(inputs.dateFrom);
                fromDate.setHours(0, 0, 0, 0);
                if (caseDate < fromDate) return false;
            }
            
            if (inputs.dateTo) {
                const toDate = new Date(inputs.dateTo);
                toDate.setHours(23, 59, 59, 999);
                if (caseDate > toDate) return false;
            }
        }
        
        if (inputs.tags) {
            const searchTags = inputs.tags.toLowerCase().split(',').map(t => t.trim());
            const caseTags = c.tags?.map(t => (t.name || t).toLowerCase()) || [];
            if (!searchTags.some(st => caseTags.some(ct => ct.includes(st)))) return false;
        }
        
        return true;
    }).slice(0, inputs.limit ? parseInt(inputs.limit) : undefined);
}

// Display Functions
function displayResults(cases) {
    resultsCount.textContent = `Found ${cases.length} case${cases.length !== 1 ? 's' : ''}`;
    
    results.innerHTML = cases.map((c, i) => `
        <div class="bg-gradient-to-r from-gray-50 to-white p-6 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 border border-gray-200 slide-in" style="animation-delay: ${i * 0.05}s">
            <div class="flex items-start justify-between mb-4">
                <div class="flex-1">
                    <h3 class="text-xl font-bold text-gray-800 mb-2 flex items-center">
                        <i class="fas fa-folder-open text-indigo-600 mr-2"></i>
                        ${c.name || c.fname + ' ' + c.lname || 'N/A'}
                    </h3>
                    <div class="flex flex-wrap gap-2 mb-3">
                        ${c.status_name ? `<span class="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">Status: ${c.status_name}</span>` : ''}
                        ${c.litigation_name ? `<span class="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-semibold">Litigation: ${c.litigation_name}</span>` : ''}
                    </div>
                </div>
                <button onclick="viewDetails(${i})" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition font-semibold">
                    <i class="fas fa-eye mr-2"></i>Details
                </button>
            </div>
            
            <div class="grid md:grid-cols-2 gap-4 text-sm">
                ${c.email ? `<div class="flex items-center text-gray-700"><i class="fas fa-envelope text-gray-400 mr-2 w-4"></i><span>${c.email}</span></div>` : ''}
                ${c.phone ? `<div class="flex items-center text-gray-700"><i class="fas fa-phone text-gray-400 mr-2 w-4"></i><span>${c.phone}</span></div>` : ''}
                ${c.created_date ? `<div class="flex items-center text-gray-700"><i class="fas fa-calendar text-gray-400 mr-2 w-4"></i><span>Created: ${new Date(c.created_date).toLocaleDateString()}</span></div>` : ''}
                ${c.case_id ? `<div class="flex items-center text-gray-700"><i class="fas fa-hashtag text-gray-400 mr-2 w-4"></i><span>ID: ${c.case_id}</span></div>` : ''}
                ${c.state ? `<div class="flex items-center text-gray-700"><i class="fas fa-map-marker-alt text-gray-400 mr-2 w-4"></i><span>${c.city ? c.city + ', ' : ''}${c.state}</span></div>` : ''}
            </div>

            ${c.tags?.length ? `
                <div class="mt-4 flex flex-wrap gap-2">
                    ${c.tags.filter(t => !String(t.name || t).toLowerCase().includes('csv import')).slice(0, 6).map(t => `
                        <span class="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs">
                            <i class="fas fa-tag mr-1"></i>${t.name || t}
                        </span>
                    `).join('')}
                    ${c.tags.length > 6 ? `<span class="px-2 py-1 bg-gray-300 text-gray-600 rounded text-xs font-semibold">+${c.tags.length - 6} more</span>` : ''}
                </div>
            ` : ''}
        </div>
    `).join('');
}

function viewDetails(index) {
    const c = currentResults[index];
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 flex items-center justify-between">
                <h2 class="text-2xl font-bold text-white">
                    <i class="fas fa-info-circle mr-3"></i>Case Details: ${c.name || 'Case ' + c.case_id}
                </h2>
                <button onclick="this.closest('.fixed').remove()" class="text-white hover:text-gray-200 transition">
                    <i class="fas fa-times text-2xl"></i>
                </button>
            </div>
            <div class="p-8">
                <div class="space-y-4">
                    ${Object.entries(c).map(([key, value]) => {
                        if (shouldHideValue(value)) return '';
                        
                        let displayValue;
                        if (['documents', 'conditions', 'information', 'tags'].includes(key)) {
                            displayValue = renderArrayField(value, key);
                        } else if (key === 'meta' || key === 'external_data') {
                            displayValue = renderObjectField(value);
                        } else if (Array.isArray(value)) {
                            displayValue = renderArrayField(value, key);
                        } else if (typeof value === 'object' && value !== null) {
                            displayValue = renderObjectField(value);
                        } else {
                            displayValue = formatValue(value);
                        }

                        return `
                            <div class="border-b border-gray-200 pb-3">
                                <div class="text-sm font-semibold text-gray-600 mb-1">${formatKey(key)}</div>
                                <div class="text-gray-800">${displayValue}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="mt-6 flex justify-end gap-3">
                    <button onclick="exportSingleCase(${index})" class="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-semibold">
                        <i class="fas fa-download mr-2"></i>Export This Case
                    </button>
                    <button onclick="this.closest('.fixed').remove()" class="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition font-semibold">
                        <i class="fas fa-check mr-2"></i>Close
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Export Functions
function exportSingleCase(index) {
    exportToJSON([currentResults[index]]);
}

function exportToCSV(cases) {
    if (!cases.length) return showNotification('No data to export', 'error');

    const allKeys = new Set();
    cases.forEach(c => Object.keys(c).forEach(k => {
        const v = c[k];
        if (typeof v !== 'object' || v === null || (Array.isArray(v) && !v.length)) allKeys.add(k);
    }));

    const headers = Array.from(allKeys);
    const csvContent = [headers.join(','), ...cases.map(c => headers.map(h => {
        let v = c[h] || '';
        if (Array.isArray(v)) v = v.map(i => typeof i === 'object' ? JSON.stringify(i) : i).join('; ');
        if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
        v = String(v).replace(/"/g, '""');
        return (v.includes(',') || v.includes('\n') || v.includes('"')) ? `"${v}"` : v;
    }).join(','))].join('\n');

    downloadFile(csvContent, 'text/csv;charset=utf-8;', `cases_export_${new Date().toISOString().split('T')[0]}.csv`);
    showNotification('CSV export successful!', 'success');
}

function exportToJSON(cases) {
    if (!cases.length) return showNotification('No data to export', 'error');
    downloadFile(JSON.stringify(cases, null, 2), 'application/json;charset=utf-8;', `cases_export_${new Date().toISOString().split('T')[0]}.json`);
    showNotification('JSON export successful!', 'success');
}

function downloadFile(content, type, filename) {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function showNotification(message, type) {
    const n = document.createElement('div');
    n.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg ${type === 'error' ? 'bg-red-500' : 'bg-green-500'} text-white z-50 slide-in`;
    n.innerHTML = `<i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'} mr-2"></i>${message}`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}