// File input handling
const fileInput = document.getElementById('csvFile');
const fileName = document.getElementById('fileName');
const fileNameText = document.getElementById('fileNameText');
const dropZone = document.getElementById('dropZone');
const previewBtn = document.getElementById('previewBtn');
const previewSection = document.getElementById('previewSection');
const tableContainer = document.getElementById('tableContainer');
const uploadSelectedBtn = document.getElementById('uploadSelectedBtn');
const cancelPreviewBtn = document.getElementById('cancelPreviewBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const selectedCount = document.getElementById('selectedCount');

// Store parsed CSV data
let csvData = [];
let csvHeaders = [];

// Show selected file name
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        fileNameText.textContent = file.name;
        fileName.classList.remove('hidden');
        previewBtn.classList.remove('hidden');
    }
});

// Drag and drop functionality
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-500', 'bg-indigo-100');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-100');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-100');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        fileNameText.textContent = files[0].name;
        fileName.classList.remove('hidden');
        previewBtn.classList.remove('hidden');
    }
});

// Preview button click
previewBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) {
        showNotification('Please select a file', 'error');
        return;
    }

    try {
        const text = await file.text();
        parseCSV(text);
        displayTable();
        previewSection.classList.remove('hidden');
        previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        showNotification('Error reading CSV file: ' + error.message, 'error');
    }
});

// Parse CSV text
function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }

    // Parse headers
    csvHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    // Parse data rows
    csvData = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === csvHeaders.length) {
            const row = {};
            csvHeaders.forEach((header, index) => {
                row[header] = values[index].trim().replace(/^"|"$/g, '');
            });
            csvData.push({ data: row, selected: true, index: i });
        }
    }
}

// Parse a single CSV line (handles quoted values with commas)
function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current);
    
    return values;
}

// Display CSV data in table
function displayTable() {
    const table = document.createElement('table');
    table.className = 'min-w-full bg-white';
    
    // Create header
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-100 sticky top-0';
    const headerRow = document.createElement('tr');
    
    // Checkbox header
    const checkboxTh = document.createElement('th');
    checkboxTh.className = 'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b';
    checkboxTh.innerHTML = '<input type="checkbox" id="selectAllCheckbox" checked class="w-4 h-4 text-indigo-600 rounded">';
    headerRow.appendChild(checkboxTh);
    
    // Row number header
    const rowNumTh = document.createElement('th');
    rowNumTh.className = 'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b';
    rowNumTh.textContent = 'Row';
    headerRow.appendChild(rowNumTh);
    
    // Data headers
    csvHeaders.forEach(header => {
        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b';
        th.textContent = header;
        headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement('tbody');
    csvData.forEach((rowData, rowIndex) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition';
        tr.dataset.index = rowIndex;
        
        // Checkbox cell
        const checkboxTd = document.createElement('td');
        checkboxTd.className = 'px-4 py-3 border-b';
        checkboxTd.innerHTML = `<input type="checkbox" ${rowData.selected ? 'checked' : ''} class="row-checkbox w-4 h-4 text-indigo-600 rounded" data-index="${rowIndex}">`;
        tr.appendChild(checkboxTd);
        
        // Row number cell
        const rowNumTd = document.createElement('td');
        rowNumTd.className = 'px-4 py-3 text-sm font-medium text-gray-900 border-b';
        rowNumTd.textContent = rowData.index;
        tr.appendChild(rowNumTd);
        
        // Data cells
        csvHeaders.forEach(header => {
            const td = document.createElement('td');
            td.className = 'px-4 py-3 text-sm text-gray-700 border-b';
            td.textContent = rowData.data[header] || '';
            tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
    
    // Add event listeners
    document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
        csvData.forEach(row => row.selected = e.target.checked);
        document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = e.target.checked);
        updateSelectedCount();
    });
    
    document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            csvData[index].selected = e.target.checked;
            updateSelectedCount();
        });
    });
    
    updateSelectedCount();
}

// Update selected count
function updateSelectedCount() {
    const count = csvData.filter(row => row.selected).length;
    selectedCount.textContent = `${count} of ${csvData.length} selected`;
    uploadSelectedBtn.disabled = count === 0;
}

// Select all button
selectAllBtn.addEventListener('click', () => {
    csvData.forEach(row => row.selected = true);
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = true);
    document.getElementById('selectAllCheckbox').checked = true;
    updateSelectedCount();
});

// Deselect all button
deselectAllBtn.addEventListener('click', () => {
    csvData.forEach(row => row.selected = false);
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('selectAllCheckbox').checked = false;
    updateSelectedCount();
});

// Cancel preview button
cancelPreviewBtn.addEventListener('click', () => {
    previewSection.classList.add('hidden');
    csvData = [];
    csvHeaders = [];
});

// Upload selected rows
uploadSelectedBtn.addEventListener('click', async () => {
    const selectedRows = csvData.filter(row => row.selected).map(row => row.data);
    
    if (selectedRows.length === 0) {
        showNotification('Please select at least one row', 'error');
        return;
    }

    const progress = document.getElementById('progress');
    const resultsDiv = document.getElementById('results');

    // Disable button and show progress
    uploadSelectedBtn.disabled = true;
    progress.classList.remove('hidden');
    resultsDiv.innerHTML = '';

    try {
        const response = await fetch('/upload-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rows: selectedRows })
        });

        const data = await response.json();
        if (response.ok) {
            // Success message
            resultsDiv.innerHTML = `
                <div class="bg-green-50 border-l-4 border-green-500 p-6 rounded-lg mb-4">
                    <div class="flex items-center mb-2">
                        <i class="fas fa-check-circle text-green-500 text-2xl mr-3"></i>
                        <h3 class="text-lg font-semibold text-green-800">Upload Successful!</h3>
                    </div>
                    <p class="text-green-700">${data.message}</p>
                </div>
            `;
            
            // Show failures if any
            if (data.failures && data.failures.length > 0) {
                resultsDiv.innerHTML += `
                    <div class="bg-yellow-50 border-l-4 border-yellow-500 p-6 rounded-lg">
                        <div class="flex items-center mb-3">
                            <i class="fas fa-exclamation-triangle text-yellow-500 text-2xl mr-3"></i>
                            <h3 class="text-lg font-semibold text-yellow-800">Some Rows Failed</h3>
                        </div>
                        <div class="max-h-64 overflow-y-auto">
                            <ul class="space-y-2">
                                ${data.failures.map(f => `
                                    <li class="text-yellow-800 bg-yellow-100 p-3 rounded">
                                        <span class="font-semibold">Row ${f.row}:</span> ${f.error}
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                `;
            }

            // Hide preview section on success
            previewSection.classList.add('hidden');
            
            // Scroll to results
            resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            resultsDiv.innerHTML = `
                <div class="bg-red-50 border-l-4 border-red-500 p-6 rounded-lg">
                    <div class="flex items-center mb-2">
                        <i class="fas fa-times-circle text-red-500 text-2xl mr-3"></i>
                        <h3 class="text-lg font-semibold text-red-800">Upload Failed</h3>
                    </div>
                    <p class="text-red-700">${data.message || 'Unknown error'}</p>
                </div>
            `;
        }
    } catch (error) {
        resultsDiv.innerHTML = `
            <div class="bg-red-50 border-l-4 border-red-500 p-6 rounded-lg">
                <div class="flex items-center mb-2">
                    <i class="fas fa-times-circle text-red-500 text-2xl mr-3"></i>
                    <h3 class="text-lg font-semibold text-red-800">Error</h3>
                </div>
                <p class="text-red-700">${error.message}</p>
            </div>
        `;
    } finally {
        uploadSelectedBtn.disabled = false;
        progress.classList.add('hidden');
    }
});

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg ${
        type === 'error' ? 'bg-red-500' : 'bg-green-500'
    } text-white z-50`;
    notification.innerHTML = `
        <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'} mr-2"></i>
        ${message}
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}
