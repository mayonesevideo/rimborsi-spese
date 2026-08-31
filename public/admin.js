const API_BASE = (window.location.protocol === 'file:') 
  ? 'http://localhost:3000' 
  : '';

let reportsList = [];
let filteredEntries = [];
let activeEntryId = null;
let activeReportId = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  
  // Check auth and verify admin role
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`);
    if (!res.ok) {
      window.location.href = '/login.html';
      return;
    }
    const user = await res.json();
    if (user.role !== 'admin') {
      window.location.href = '/user.html';
      return;
    }

    setupLogout();
    populateBimestreDropdown();
    fetchReports();
    setupGlobalListeners();
  } catch (err) {
    console.error('Session verification failed:', err);
    window.location.href = '/login.html';
  }
});

function setupLogout() {
  const logoutBtn = document.getElementById('logout-btn') || createLogoutButton();
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const res = await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
      if (res.ok) {
        window.location.href = '/login.html';
      }
    });
  }
}

function createLogoutButton() {
  const header = document.querySelector('header .header-controls') || document.querySelector('header');
  if (!header) return null;
  
  const btn = document.createElement('button');
  btn.id = 'logout-btn';
  btn.className = 'btn btn-outline btn-sm';
  btn.style.borderColor = 'var(--danger)';
  btn.style.color = 'var(--danger)';
  btn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Esci';
  header.appendChild(btn);
  return btn;
}

// --- Theme Management ---
function initTheme() {
  const body = document.body;
  const themeToggle = document.getElementById('theme-toggle');
  
  const savedTheme = localStorage.getItem('rimborsi_v2_theme') || 'dark';
  body.setAttribute('data-theme', savedTheme);
  updateThemeToggleIcon(savedTheme);
  
  themeToggle.addEventListener('click', () => {
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('rimborsi_v2_theme', newTheme);
    updateThemeToggleIcon(newTheme);
  });
}

function updateThemeToggleIcon(theme) {
  const themeToggle = document.getElementById('theme-toggle');
  if (theme === 'light') {
    themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
  } else {
    themeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
  }
}

// --- Global Listeners ---
function setupGlobalListeners() {
  const excelModal = document.getElementById('excel-preview-modal');
  const excelClose = document.getElementById('excel-preview-close');
  const excelCloseBtn = document.getElementById('excel-preview-close-btn');

  if (excelModal) {
    const hideExcelModal = () => excelModal.classList.remove('active');
    if (excelClose) excelClose.addEventListener('click', hideExcelModal);
    if (excelCloseBtn) excelCloseBtn.addEventListener('click', hideExcelModal);
  }

  // Trash modal listeners
  const trashModal = document.getElementById('trash-modal');
  const trashOpenBtn = document.getElementById('btn-open-trash');
  const trashClose = document.getElementById('trash-modal-close');
  const trashCloseBtn = document.getElementById('trash-modal-close-btn');

  if (trashModal && trashOpenBtn) {
    trashOpenBtn.addEventListener('click', () => {
      trashModal.classList.add('active');
      fetchAndRenderTrash();
    });
    const hideTrashModal = () => trashModal.classList.remove('active');
    if (trashClose) trashClose.addEventListener('click', hideTrashModal);
    if (trashCloseBtn) trashCloseBtn.addEventListener('click', hideTrashModal);
  }

  // Viola modal listeners
  const btnOpenViola = document.getElementById('btn-open-viola');
  if (btnOpenViola) {
    btnOpenViola.addEventListener('click', () => {
      openViolaModal();
    });
  }
  setupViolaModalHandlers();

  // Breakdown Close Button
  const breakdownClose = document.getElementById('breakdown-close');
  if (breakdownClose) {
    breakdownClose.addEventListener('click', () => {
      document.getElementById('stats-breakdown-drawer').style.display = 'none';
      activeStatType = null;
    });
  }

  // Stats Cards click listeners
  setupStatsCardsClickListeners();

  // Filter Panel listeners
  setupFilterPanelListeners();
}

// --- Fetch Reports & Statistics ---
async function fetchReports() {
  const tableBody = document.getElementById('reports-list');
  try {
    const response = await fetch(`${API_BASE}/api/reports`);
    if (!response.ok) throw new Error('Impossibile recuperare le note spese.');
    
    reportsList = await response.json();
    
    // Sort reports: most recent first
    reportsList.sort((a, b) => new Date(b.dateSubmitted) - new Date(a.dateSubmitted));

    populateDipendentiDropdown();
    renderReportsTable();
  } catch (error) {
    console.error(error);
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--danger); padding: 40px;">
          <i class="fa-solid fa-circle-exclamation" style="font-size: 24px; margin-bottom: 10px; display:block;"></i>
          Errore nel caricamento dei dati: ${error.message}
        </td>
      </tr>
    `;
    showToast(`Errore: ${error.message}`, 'danger');
  }
}

function populateDipendentiDropdown() {
  const select = document.getElementById('select-dipendente');
  if (!select) return;

  // Extract unique employee names from reportsList
  const employees = [...new Set(reportsList.map(r => r.employee).filter(Boolean))].sort();

  const prevValue = select.value;

  let html = '';
  employees.forEach(emp => {
    html += `<option value="${emp}">${emp}</option>`;
  });

  select.innerHTML = html;

  if (prevValue && select.querySelector(`option[value="${prevValue}"]`)) {
    select.value = prevValue;
  } else {
    select.value = employees[0] || "";
  }
}

function updateStatistics(filteredList = filteredEntries) {
  const totalReportsEl = document.getElementById('stat-total-reports');
  const totalMoneyEl = document.getElementById('stat-total-money');
  const totalItemsEl = document.getElementById('stat-total-items');
  const totalFilesEl = document.getElementById('stat-total-files');

  let totalMoney = 0;
  let totalFiles = 0;
  const uniqueReports = new Set();

  filteredList.forEach(entry => {
    uniqueReports.add(entry.reportId);
    const isGiustificativo = entry.reimbursementType === 'giustificativo';
    const kmRefund = (!isGiustificativo && entry.type === 'trasferta') ? (Number(entry.km) || 0) * (Number(entry.profile.costKm) || 0) : 0;
    const entryTotal = isGiustificativo ? 0 : ((Number(entry.flatRate) || 0) + (Number(entry.tolls) || 0) + kmRefund + (Number(entry.other) || 0));
    totalMoney += entryTotal;
    totalFiles += entry.attachments ? entry.attachments.length : 0;
  });

  totalReportsEl.innerText = uniqueReports.size;
  totalMoneyEl.innerText = totalMoney.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  totalItemsEl.innerText = filteredList.length;
  totalFilesEl.innerText = totalFiles;
}

function renderReportsTable() {
  const tableBody = document.getElementById('reports-list');
  tableBody.innerHTML = '';

  const select = document.getElementById('select-bimestre');
  const selectDipendente = document.getElementById('select-dipendente');
  const selectedEmp = selectDipendente ? selectDipendente.value : '';

  // Update dynamic header summary
  const tableTitle = document.getElementById('table-title');
  if (tableTitle && select) {
    const bimestreText = select.options[select.selectedIndex]?.text || '';
    const employeeText = selectedEmp ? selectedEmp : 'Tutti i dipendenti';
    tableTitle.innerHTML = `<i class="fa-solid fa-list-check" style="color: var(--primary);"></i> Riepilogo Spese: <span style="color: var(--primary);">${employeeText}</span> (${bimestreText})`;
  }

  let startVal = '';
  let endVal = '';
  if (select && select.value) {
    const parts = select.value.split('|');
    startVal = parts[0];
    endVal = parts[1];
  }

  // Flatten reports into entries
  let allEntries = [];
  reportsList.forEach(report => {
    report.items.forEach(item => {
      allEntries.push({
        ...item,
        reportId: report.id,
        employee: report.employee,
        profile: report.profile,
        attachments: item.attachments || []
      });
    });
  });

  let filtered = [...allEntries];

  if (startVal || endVal) {
    const startLimit = startVal ? `${startVal}-01` : '0000-01-01';
    let endLimit = '9999-12-31';
    if (endVal) {
      const parts = endVal.split('-');
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      const lastDay = new Date(year, month, 0).getDate();
      endLimit = `${endVal}-${String(lastDay).padStart(2, '0')}`;
    }

    filtered = allEntries.filter(entry => {
      const entryDate = entry.date || '0000-01-01';
      return entryDate >= startLimit && entryDate <= endLimit;
    });
  }

  if (selectedEmp) {
    filtered = filtered.filter(entry => entry.employee === selectedEmp);
  }

  // Sort chronologically by date
  filtered.sort((a, b) => {
    const dateA = a.date ? new Date(a.date) : new Date('9999-12-31');
    const dateB = b.date ? new Date(b.date) : new Date('9999-12-31');
    return dateA - dateB;
  });

  filteredEntries = filtered; // Save globally

  updateStatistics(filtered);

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
          <i class="fa-solid fa-folder-open" style="font-size: 40px; margin-bottom: 12px; opacity: 0.3; color: var(--primary);"></i>
          <p style="font-weight: 500;">Nessun risultato corrispondente al bimestre selezionato</p>
          <span style="font-size: 11px; color: var(--text-muted);">Scegli un altro bimestre o carica nuovi dati.</span>
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((entry, i) => {
    const row = document.createElement('tr');
    row.setAttribute('data-entry-id', entry.id);
    if (entry.id === activeEntryId) {
      row.className = 'active-row';
    }

    const dateFormatted = entry.date ? entry.date.split('-').reverse().join('/') : '';
    
    // Calculate entry total
    const isGiustificativo = entry.reimbursementType === 'giustificativo';
    const kmRefund = (!isGiustificativo && entry.type === 'trasferta') ? (Number(entry.km) || 0) * (Number(entry.profile.costKm) || 0) : 0;
    const entryTotal = isGiustificativo ? 0 : ((Number(entry.flatRate) || 0) + (Number(entry.tolls) || 0) + kmRefund + (Number(entry.other) || 0));
    const moneyFormatted = entryTotal.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

    // Attachment indicators
    const attachmentsCount = entry.attachments ? entry.attachments.length : 0;
    
    row.innerHTML = `
      <td style="text-align: center; font-weight: bold; color: var(--success);">#${i + 1}</td>
      <td><span style="font-family: var(--font-title); font-weight: 500;">${dateFormatted}</span></td>
      <td><span style="font-weight: 500;">${entry.client || ''}</span></td>
      <td>
        <span class="badge ${entry.type === 'trasferta' ? 'badge-primary' : (isGiustificativo ? 'badge-outline' : 'badge-secondary')}" style="font-size: 10px; padding: 3px 6px;">
          ${entry.type === 'trasferta' ? 'Trasferta' : (isGiustificativo ? 'Giustificativo' : 'Solo Spesa')}
        </span>
      </td>
      <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${entry.description || ''}">${entry.description || ''}</td>
      <td style="text-align: center; color: var(--text-secondary); font-weight: 500;">${entry.type === 'trasferta' && entry.km ? entry.km : '-'}</td>
      <td><span class="badge badge-money" style="float: right;">${moneyFormatted}</span></td>
      <td style="text-align: right; white-space: nowrap;" class="actions-td">
        <button class="btn btn-outline btn-sm view-btn" title="Vedi Dettagli & Allegati" style="padding: 5px 10px; font-size:11px;">
          <i class="fa-solid fa-eye"></i> Vedi
        </button>
        <button class="btn btn-secondary btn-sm zip-btn" title="Scarica Allegati ZIP" style="padding: 5px 10px; font-size:11px;" ${attachmentsCount === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-file-zipper"></i> ZIP
        </button>
        <button class="btn btn-danger btn-sm delete-btn" style="padding: 5px; width: 26px; height: 26px; border-radius: 6px;" title="Elimina Nota Spese">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;

    // Row click opens details
    row.addEventListener('click', (e) => {
      if (e.target.closest('.actions-td') || e.target.closest('.btn')) return;
      viewEntryDetails(entry);
    });

    row.querySelector('.view-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      viewEntryDetails(entry);
    });

    row.querySelector('.zip-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      downloadZip(entry.reportId);
    });

    row.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteReport(entry.reportId);
    });

    tableBody.appendChild(row);
  });
}

function viewEntryDetails(entry) {
  activeEntryId = entry.id;
  
  // Highlight selected row
  document.querySelectorAll('#reports-list tr').forEach(row => {
    if (row.getAttribute('data-entry-id') === entry.id) {
      row.classList.add('active-row');
    } else {
      row.classList.remove('active-row');
    }
  });

  const pane = document.getElementById('detail-pane');
  const layout = document.getElementById('admin-layout-container');
  pane.style.display = 'block';
  layout.classList.add('has-detail');

  const isGiustificativo = entry.reimbursementType === 'giustificativo';
  const kmRefund = (!isGiustificativo && entry.type === 'trasferta') ? (Number(entry.km) || 0) * (Number(entry.profile.costKm) || 0) : 0;
  const entryTotal = isGiustificativo ? 0 : ((Number(entry.flatRate) || 0) + (Number(entry.tolls) || 0) + kmRefund + (Number(entry.other) || 0));

  const attachments = entry.attachments || [];
  let attachmentsHtml = '';
  if (attachments.length === 0) {
    attachmentsHtml = '<p style="font-size:12px; color: var(--text-muted); font-style:italic; margin-top:5px;">Nessun allegato caricato per questa voce.</p>';
  } else {
    attachmentsHtml = `
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
        ${attachments.map(att => {
          const isPdf = att.name.toLowerCase().endsWith('.pdf');
          // Clean client and date for filename
          const clientClean = (entry.client || 'Generico').trim().replace(/[^a-zA-Z0-9]/g, '_');
          let dateClean = '00_00_0000';
          if (entry.date) {
            const parts = entry.date.split('-');
            if (parts.length === 3) {
              dateClean = `${parts[2]}_${parts[1]}_${parts[0]}`;
            }
          }
          const idx = filteredEntries.findIndex(e => e.id === entry.id) + 1;
          const sanitizedOriginal = att.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          const prefix = entry.reimbursementType === 'giustificativo' ? 'G' : 'RA';
          const targetFilename = `${idx}_${prefix}_${clientClean}_${dateClean}_${sanitizedOriginal}`;

          return `
            <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); padding:8px 12px; border:1px solid var(--border-color); border-radius:6px;">
              <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                <i class="fa-solid ${isPdf ? 'fa-file-pdf' : 'fa-file-image'}" style="color:${isPdf ? '#ef4444' : '#6366f1'}; font-size:16px;"></i>
                <div style="min-width:0; flex:1;">
                  <div style="font-size:12px; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; color:#fff;" title="${att.name}">${att.name}</div>
                  <div style="font-size:10px; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${targetFilename}">Nome ZIP: ${targetFilename}</div>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="openAttachmentDirectly('${entry.reportId}', '${att.fileName}', ${isPdf})" style="padding:4px 8px; font-size:11px; height:24px; margin-left:8px; flex-shrink:0;">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Apri
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  pane.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:15px;">
      <h4 style="font-family: var(--font-title); font-size: 15px; font-weight: 700; color: #ffffff; margin: 0; display:flex; align-items:center; gap:6px;">
        <i class="fa-solid fa-receipt" style="color: var(--primary);"></i> Voce Spesa
      </h4>
      <button onclick="closeDetailPane()" class="modal-close" style="font-size: 14px;"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div style="display:flex; flex-direction:column; gap:12px;">
      <!-- Employee badge -->
      <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.15); border-radius: 8px; padding: 10px; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-user-tie" style="font-size: 20px; color: var(--primary);"></i>
        <div>
          <div style="font-size: 13px; font-weight: 700; color:#fff;">${entry.employee}</div>
          <div style="font-size: 10px; color: var(--text-secondary);">${entry.profile.company}</div>
        </div>
      </div>

      <!-- Details list -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:12px;">
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
          <span style="color:var(--text-muted); display:block; font-size:10px;">DATA</span>
          <strong style="color:#fff;">${entry.date ? entry.date.split('-').reverse().join('/') : ''}</strong>
        </div>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
          <span style="color:var(--text-muted); display:block; font-size:10px;">CLIENTE</span>
          <strong style="color:#fff;">${entry.client || '-'}</strong>
        </div>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
          <span style="color:var(--text-muted); display:block; font-size:10px;">TIPO</span>
          <strong style="color:#fff;">${entry.type === 'trasferta' ? 'Trasferta' : (isGiustificativo ? 'Giustificativo' : 'Solo Spesa')}</strong>
        </div>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
          <span style="color:var(--text-muted); display:block; font-size:10px;">NUM. RIGA (COL. A)</span>
          <strong style="color: var(--success);">#${filteredEntries.indexOf(entry) + 1}</strong>
        </div>
      </div>

      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 10px; border-radius: 6px; font-size:12px;">
        <span style="color:var(--text-muted); display:block; font-size:10px; margin-bottom:2px;">TRATTA / DESCRIZIONE</span>
        <strong style="color:#fff; word-break: break-word;">${entry.description || '-'}</strong>
      </div>

      <!-- Breakdown table -->
      <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow:hidden; background: rgba(0,0,0,0.1); font-size: 12px;">
        <div style="background: rgba(255,255,255,0.02); padding: 8px 12px; font-weight: 700; border-bottom: 1px solid var(--border-color); color:#fff; display:flex; justify-content:space-between;">
          <span>Dettaglio Spesa</span>
          <span>Valore</span>
        </div>
        <div style="padding: 6px 12px; display:flex; justify-content:space-between; border-bottom: 1px solid rgba(255,255,255,0.03);">
          <span style="color:var(--text-secondary);">Rimb. Chilometrico</span>
          <span style="color:#fff;">${entry.type === 'trasferta' && entry.km ? '€ ' + kmRefund.toFixed(2) + ' (' + entry.km + ' KM)' : '-'}</span>
        </div>
        <div style="padding: 6px 12px; display:flex; justify-content:space-between; border-bottom: 1px solid rgba(255,255,255,0.03);">
          <span style="color:var(--text-secondary);">Rimborso Forfettario</span>
          <span style="color:#fff;">${entry.flatRate ? '€ ' + parseFloat(entry.flatRate).toFixed(2) : '-'}</span>
        </div>
        <div style="padding: 6px 12px; display:flex; justify-content:space-between; border-bottom: 1px solid rgba(255,255,255,0.03);">
          <span style="color:var(--text-secondary);">Pedaggi / Autostrada</span>
          <span style="color:#fff;">${entry.tolls ? '€ ' + parseFloat(entry.tolls).toFixed(2) : '-'}</span>
        </div>
        <div style="padding: 6px 12px; display:flex; justify-content:space-between; border-bottom: 1px solid rgba(255,255,255,0.03);">
          <span style="color:var(--text-secondary);">Altro (Spesa Totale)</span>
          <span style="color:#fff;">${entry.other ? '€ ' + parseFloat(entry.other).toFixed(2) : '-'}</span>
        </div>
        <div style="padding: 8px 12px; display:flex; justify-content:space-between; font-weight:700; background: rgba(99,102,241,0.05); border-top: 1px solid var(--border-color); color: var(--success); font-size:13px;">
          <span>Totale Voce</span>
          <span>€ ${entryTotal.toFixed(2)}</span>
        </div>
      </div>

      <!-- Attachments section -->
      <div>
        <label style="font-size: 11px; font-weight:600; color: var(--text-secondary); text-transform: uppercase;">Ricevute & Allegati</label>
        ${attachmentsHtml}
      </div>

      <!-- Action Delete report -->
      <button class="btn btn-danger btn-sm" onclick="deleteReport('${entry.reportId}')" style="margin-top: 15px; width: 100%; display:flex; justify-content:center; align-items:center; gap:6px;">
        <i class="fa-solid fa-trash-can"></i> Sposta Nota Spese nel Cestino
      </button>
    </div>
  `;
}

function closeDetailPane() {
  const detailPane = document.getElementById('detail-pane');
  const layout = document.getElementById('admin-layout-container');
  
  detailPane.style.display = 'none';
  layout.classList.remove('has-detail');
  
  const rows = document.querySelectorAll('#reports-list tr');
  rows.forEach(r => r.classList.remove('active-row'));
  
  activeReportId = null;
  activeEntryId = null;
}

// --- Actions (Download / Delete) ---
function downloadExcel(reportId) {
  const highlight = document.getElementById('chk-highlight-viola')?.checked ? 'true' : 'false';
  window.open(`${API_BASE}/api/reports/${reportId}/excel?highlightViola=${highlight}`, '_blank');
  showToast('Download file Excel avviato.', 'success');
}

function downloadZip(reportId) {
  window.open(`${API_BASE}/api/reports/${reportId}/zip`, '_blank');
  showToast('Download file ZIP allegati avviato.', 'success');
}

async function deleteReport(reportId) {
  if (!confirm('Sei sicuro di voler spostare questa nota spese nel cestino? Rimarrà ripristinabile per 60 giorni.')) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/reports/${reportId}`, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Errore durante lo spostamento nel cestino.');

    showToast('Nota spese spostata nel cestino.', 'success');
    
    const activeEntry = filteredEntries.find(e => e.id === activeEntryId);
    if (activeEntry && activeEntry.reportId === reportId) {
      closeDetailPane();
    }
    
    fetchReports();
  } catch (error) {
    console.error(error);
    showToast(`Errore: ${error.message}`, 'danger');
  }
}

// --- Toast notifications ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-check-circle';
  else if (type === 'warning') icon = 'fa-triangle-exclamation';
  else if (type === 'danger') icon = 'fa-circle-xmark';
  
  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <div style="flex:1;">${message}</div>
    <button class="toast-close" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; margin-left:10px;"><i class="fa-solid fa-xmark"></i></button>
  `;
  
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => toast.remove());
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function showExcelPreview(report, highlightViola = false) {
  const excelModal = document.getElementById('excel-preview-modal');
  const excelRowsContainer = document.getElementById('excel-preview-rows');

  if (!excelModal || !excelRowsContainer) return;

  let html = '';
  let totalForfettario = 0;
  let totalPedaggi = 0;
  let totalKM = 0;
  let totalRimbKM = 0;
  let totalAltro = 0;
  let totalGeneral = 0;

  // Sort items chronologically by date
  const sortedItems = [...report.items].sort((a, b) => {
    const dateA = a.date ? new Date(a.date) : new Date('9999-12-31');
    const dateB = b.date ? new Date(b.date) : new Date('9999-12-31');
    return dateA - dateB;
  });

  const highlight = highlightViola;

  sortedItems.forEach((entry, i) => {
    const isGiustificativo = entry.reimbursementType === 'giustificativo';
    const kmRefund = entry.type === 'trasferta' ? (Number(entry.km) || 0) * (Number(report.profile.costKm) || 0) : 0;
    const rowTotal = (Number(entry.flatRate) || 0) + (Number(entry.tolls) || 0) + kmRefund + (Number(entry.other) || 0);

    totalForfettario += Number(entry.flatRate) || 0;
    totalPedaggi += Number(entry.tolls) || 0;
    totalKM += entry.type === 'trasferta' ? (Number(entry.km) || 0) : 0;
    totalRimbKM += kmRefund;
    totalAltro += Number(entry.other) || 0;
    totalGeneral += rowTotal;

    const dateFormatted = entry.date ? entry.date.split('-').reverse().join('/') : '';
    const dateRange = (entry.type === 'trasferta' && entry.endDate && entry.endDate !== entry.date)
      ? `${dateFormatted} - ${entry.endDate.split('-').reverse().join('/')}`
      : dateFormatted;

    const isViola = entry.color === 'viola' && highlight;
    const rowBg = isViola ? '#f1e8fd' : (i % 2 === 0 ? '#ffffff' : '#fcfcfc');

    const displayDesc = isGiustificativo ? `[G] ${entry.description || ''}` : (entry.description || '');

    html += `
      <div style="display: flex; border-bottom: 1px solid #d3d3d3; min-height: 28px; align-items: center; background: ${rowBg};">
        <div style="width: 40px; border-right: 1px solid #d3d3d3; text-align: center; color: #7f7f7f; font-size: 11px; font-weight: bold; background: #f3f2f1; align-self: stretch; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${i + 9}</div>
        <div style="width: 40px; border-right: 1px solid #d3d3d3; text-align: center; flex-shrink: 0; padding: 4px 0;">${i + 1}</div>
        <div style="width: 90px; border-right: 1px solid #d3d3d3; text-align: center; flex-shrink: 0; padding: 4px 0;">${dateRange}</div>
        <div style="width: 140px; border-right: 1px solid #d3d3d3; padding: 4px 8px; flex-shrink: 0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${entry.client || ''}">${entry.client || ''}</div>
        <div style="width: 200px; border-right: 1px solid #d3d3d3; padding: 4px 8px; flex-shrink: 0; flex-grow: 1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${displayDesc}">${displayDesc}</div>
        <div style="width: 95px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">${entry.flatRate ? '€ ' + parseFloat(entry.flatRate).toFixed(2) : '-'}</div>
        <div style="width: 80px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">${entry.tolls ? '€ ' + parseFloat(entry.tolls).toFixed(2) : '-'}</div>
        <div style="width: 75px; border-right: 1px solid #d3d3d3; text-align: center; padding: 4px 0; flex-shrink: 0;">${entry.type === 'trasferta' && entry.km ? entry.km : '-'}</div>
        <div style="width: 90px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">${kmRefund ? '€ ' + kmRefund.toFixed(2) : '-'}</div>
        <div style="width: 80px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">${entry.other ? '€ ' + parseFloat(entry.other).toFixed(2) : '-'}</div>
        <div style="width: 90px; text-align: right; padding: 4px 8px; flex-shrink: 0; font-weight: bold; background: #f3f2f1;">€ ${rowTotal.toFixed(2)}</div>
      </div>
    `;
  });

  // Totals row
  html += `
    <div style="display: flex; border-bottom: 2px solid #107c41; min-height: 30px; align-items: center; background: #e1dfdd; font-weight: bold;">
      <div style="width: 40px; text-align: center; color: #7f7f7f; font-size: 11px; font-weight: bold; background: #f3f2f1; align-self: stretch; display: flex; align-items: center; justify-content: center; border-right: 1px solid #d3d3d3; flex-shrink: 0;">${report.items.length + 9}</div>
      <div style="width: 40px; border-right: 1px solid #d3d3d3; text-align: center; flex-shrink: 0; padding: 4px 0;"></div>
      <div style="width: 90px; border-right: 1px solid #d3d3d3; text-align: center; flex-shrink: 0; padding: 4px 0;"></div>
      <div style="width: 140px; border-right: 1px solid #d3d3d3; padding: 4px 8px; flex-shrink: 0; text-align: right;">TOTALI:</div>
      <div style="width: 200px; border-right: 1px solid #d3d3d3; padding: 4px 8px; flex-shrink: 0; flex-grow: 1;"></div>
      <div style="width: 95px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">€ ${totalForfettario.toFixed(2)}</div>
      <div style="width: 80px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">€ ${totalPedaggi.toFixed(2)}</div>
      <div style="width: 75px; border-right: 1px solid #d3d3d3; text-align: center; padding: 4px 0; flex-shrink: 0;">${totalKM}</div>
      <div style="width: 90px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">€ ${totalRimbKM.toFixed(2)}</div>
      <div style="width: 80px; border-right: 1px solid #d3d3d3; text-align: right; padding: 4px 8px; flex-shrink: 0;">€ ${totalAltro.toFixed(2)}</div>
      <div style="width: 90px; text-align: right; padding: 4px 8px; flex-shrink: 0; color: #107c41; background: #d0f0db; border-top: 1px double #107c41; font-size: 14px;">€ ${totalGeneral.toFixed(2)}</div>
    </div>
  `;

  excelRowsContainer.innerHTML = html;
  excelModal.classList.add('active');
}

let activeStatType = null;

function setupStatsCardsClickListeners() {
  const statsCards = document.querySelectorAll('.stat-card');
  statsCards.forEach((card, index) => {
    card.addEventListener('click', () => {
      const types = ['total-reports', 'total-money', 'total-items', 'total-files'];
      const clickedType = types[index];
      toggleStatsBreakdown(clickedType);
    });
  });
}

function toggleStatsBreakdown(type) {
  const drawer = document.getElementById('stats-breakdown-drawer');
  const titleEl = document.getElementById('breakdown-title');
  const contentEl = document.getElementById('breakdown-content');

  if (!drawer || !titleEl || !contentEl) return;

  if (activeStatType === type) {
    drawer.style.display = 'none';
    activeStatType = null;
    return;
  }

  activeStatType = type;
  drawer.style.display = 'block';

  let title = '';
  let html = '';

  if (type === 'total-reports') {
    title = '<i class="fa-solid fa-file-invoice-dollar" style="color:var(--primary); margin-right:4px;"></i> Dettaglio Note Spese Ricevute';
    if (reportsList.length === 0) {
      html = '<p style="padding:10px 0; font-style:italic;">Nessuna nota spese disponibile.</p>';
    } else {
      html = `
        <table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.08); text-align:left; color:var(--text-secondary);">
              <th style="padding:6px 8px;">Dipendente</th>
              <th style="padding:6px 8px;">Periodo di riferimento</th>
              <th style="padding:6px 8px;">Inviato il</th>
              <th style="padding:6px 8px; text-align:right;">Importo</th>
            </tr>
          </thead>
          <tbody>
      `;
      reportsList.forEach(r => {
        const dateStr = new Date(r.dateSubmitted).toLocaleDateString('it-IT');
        html += `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:8px; font-weight:600; color:#fff;">${r.employee}</td>
            <td style="padding:8px;">${r.period}</td>
            <td style="padding:8px; color:var(--text-muted);">${dateStr}</td>
            <td style="padding:8px; text-align:right; font-weight:600; color:var(--success);">${parseFloat(r.totalSpent).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</td>
          </tr>
        `;
      });
      html += '</tbody></table>';
    }
  } else if (type === 'total-money') {
    title = '<i class="fa-solid fa-sack-dollar" style="color:var(--accent); margin-right:4px;"></i> Ripartizione Costi e Rimborsi';
    
    let sumKmRefund = 0;
    let sumFlat = 0;
    let sumTolls = 0;
    let sumOther = 0;

    reportsList.forEach(r => {
      r.items.forEach(item => {
        if (item.type === 'trasferta' && item.km) {
          sumKmRefund += (item.km * (r.profile.costKm || 0));
        }
        sumFlat += Number(item.flatRate) || 0;
        sumTolls += Number(item.tolls) || 0;
        sumOther += Number(item.other) || 0;
      });
    });

    const totalSpent = sumKmRefund + sumFlat + sumTolls + sumOther;

    const pKm = totalSpent ? ((sumKmRefund / totalSpent) * 100).toFixed(1) : 0;
    const pFlat = totalSpent ? ((sumFlat / totalSpent) * 100).toFixed(1) : 0;
    const pTolls = totalSpent ? ((sumTolls / totalSpent) * 100).toFixed(1) : 0;
    const pOther = totalSpent ? ((sumOther / totalSpent) * 100).toFixed(1) : 0;

    html = `
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Rimborsi Chilometrici</span>
            <strong>${sumKmRefund.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} (${pKm}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pKm}%; height:100%; background:var(--primary);"></div>
          </div>
        </div>
        
        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Rimborsi Forfettari</span>
            <strong>${sumFlat.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} (${pFlat}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pFlat}%; height:100%; background:var(--accent);"></div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Pedaggi / Autostrada</span>
            <strong>${sumTolls.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} (${pTolls}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pTolls}%; height:100%; background:var(--success);"></div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Spese Varie / Altro (Pasti, ecc.)</span>
            <strong>${sumOther.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} (${pOther}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pOther}%; height:100%; background:var(--warning);"></div>
          </div>
        </div>
        
        <div style="border-top:1px dashed rgba(255,255,255,0.1); padding-top:10px; margin-top:4px; display:flex; justify-content:space-between; font-weight:600; font-size:12px; color:#fff;">
          <span>Importo Totale Liquidato</span>
          <span style="color:var(--success); font-size:14px;">${totalSpent.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</span>
        </div>
      </div>
    `;
  } else if (type === 'total-items') {
    title = '<i class="fa-solid fa-car-side" style="color:var(--success); margin-right:4px;"></i> Tipologia Righe Spesa Caricate';
    
    let countTrasferte = 0;
    let countSpese = 0;

    reportsList.forEach(r => {
      r.items.forEach(item => {
        if (item.type === 'trasferta') countTrasferte++;
        else countSpese++;
      });
    });

    const totalItems = countTrasferte + countSpese;
    const pTrasferte = totalItems ? ((countTrasferte / totalItems) * 100).toFixed(1) : 0;
    const pSpese = totalItems ? ((countSpese / totalItems) * 100).toFixed(1) : 0;

    html = `
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Trasferte con veicolo privato</span>
            <strong>${countTrasferte} righe (${pTrasferte}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pTrasferte}%; height:100%; background:var(--primary);"></div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Solo Spese (Scontrini / Ricevute generiche)</span>
            <strong>${countSpese} righe (${pSpese}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pSpese}%; height:100%; background:var(--accent);"></div>
          </div>
        </div>
        
        <div style="border-top:1px dashed rgba(255,255,255,0.1); padding-top:10px; margin-top:4px; display:flex; justify-content:space-between; font-weight:600; font-size:12px; color:#fff;">
          <span>Totale Righe Registrate</span>
          <span>${totalItems} voci</span>
        </div>
      </div>
    `;
  } else if (type === 'total-files') {
    title = '<i class="fa-solid fa-paperclip" style="color:var(--warning); margin-right:4px;"></i> Classificazione Documenti Allegati';
    
    let countTelepass = 0;
    let countAutostrada = 0;
    let countParcheggio = 0;
    let countPasto = 0;
    let countGenerico = 0;

    reportsList.forEach(r => {
      r.items.forEach(item => {
        if (item.attachments) {
          item.attachments.forEach(att => {
            const type = att.type || 'generico';
            if (type === 'telepass') countTelepass++;
            else if (type === 'autostrada') countAutostrada++;
            else if (type === 'parcheggio') countParcheggio++;
            else if (type === 'pasto') countPasto++;
            else countGenerico++;
          });
        }
      });
    });

    const totalFiles = countTelepass + countAutostrada + countParcheggio + countPasto + countGenerico;

    const pTelepass = totalFiles ? ((countTelepass / totalFiles) * 100).toFixed(1) : 0;
    const pAutostrada = totalFiles ? ((countAutostrada / totalFiles) * 100).toFixed(1) : 0;
    const pParcheggio = totalFiles ? ((countParcheggio / totalFiles) * 100).toFixed(1) : 0;
    const pPasto = totalFiles ? ((countPasto / totalFiles) * 100).toFixed(1) : 0;
    const pGenerico = totalFiles ? ((countGenerico / totalFiles) * 100).toFixed(1) : 0;

    html = `
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Pedaggi Telepass</span>
            <strong>${countTelepass} file (${pTelepass}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pTelepass}%; height:100%; background:var(--primary);"></div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Biglietti Autostrada</span>
            <strong>${countAutostrada} file (${pAutostrada}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pAutostrada}%; height:100%; background:var(--success);"></div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Ricevute Parcheggio</span>
            <strong>${countParcheggio} file (${pParcheggio}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pParcheggio}%; height:100%; background:var(--accent);"></div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Scontrini Pasti</span>
            <strong>${countPasto} file (${pPasto}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pPasto}%; height:100%; background:var(--warning);"></div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>Documenti Generici</span>
            <strong>${countGenerico} file (${pGenerico}%)</strong>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${pGenerico}%; height:100%; background:var(--text-muted);"></div>
          </div>
        </div>
        
        <div style="border-top:1px dashed rgba(255,255,255,0.1); padding-top:10px; margin-top:4px; display:flex; justify-content:space-between; font-weight:600; font-size:12px; color:#fff;">
          <span>Totale Allegati Ricevuti</span>
          <span>${totalFiles} file</span>
        </div>
      </div>
    `;
  }

  titleEl.innerHTML = title;
  contentEl.innerHTML = html;
}

function setupFilterPanelListeners() {
  const select = document.getElementById('select-bimestre');
  const selectDipendente = document.getElementById('select-dipendente');
  const btnPreviewGeneral = document.getElementById('btn-preview-general');
  const btnExportExcel = document.getElementById('btn-filter-excel');

  if (selectDipendente) {
    selectDipendente.addEventListener('change', () => {
      renderReportsTable();
    });
  }

  const btnPreviewHighlighted = document.getElementById('btn-preview-highlighted');
  const btnExportHighlighted = document.getElementById('btn-export-highlighted');

  const buildConsolidatedReport = () => {
    if (filteredEntries.length === 0) return null;
    const selectedEmp = selectDipendente ? selectDipendente.value : '';
    const firstProfile = filteredEntries[0].profile;
    return {
      profile: selectedEmp ? {
        name: firstProfile.name,
        surname: firstProfile.surname,
        company: firstProfile.company || 'Mayonese S.R.L.',
        role: firstProfile.role || '',
        period: select.options[select.selectedIndex].text,
        vehicle: firstProfile.vehicle || '-',
        plate: firstProfile.plate || '-',
        engine: firstProfile.engine || '-',
        fuel: firstProfile.fuel || '-',
        costKm: firstProfile.costKm || 0.45,
        flatRateRate: firstProfile.flatRateRate || 46.48
      } : {
        name: 'CONSOLIDATO',
        surname: 'AMMINISTRAZIONE',
        company: 'Mayonese S.R.L.',
        period: select.options[select.selectedIndex].text,
        costKm: firstProfile.costKm || 0.45,
        flatRateRate: firstProfile.flatRateRate || 46.48
      },
      items: filteredEntries.map(e => ({
        ...e,
        client: selectedEmp ? (e.client || '') : `[${e.employee}] ${e.client || ''}`
      }))
    };
  };

  if (btnPreviewGeneral) {
    btnPreviewGeneral.addEventListener('click', () => {
      const report = buildConsolidatedReport();
      if (!report) {
        showToast('Nessuna voce di spesa visualizzata nel bimestre corrente per l\'anteprima.', 'warning');
        return;
      }
      showExcelPreview(report, false);
    });
  }

  if (btnPreviewHighlighted) {
    btnPreviewHighlighted.addEventListener('click', () => {
      const report = buildConsolidatedReport();
      if (!report) {
        showToast('Nessuna voce di spesa visualizzata nel bimestre corrente per l\'anteprima.', 'warning');
        return;
      }
      showExcelPreview(report, true);
    });
  }

  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', () => {
      if (!select || !select.value) return;
      const parts = select.value.split('|');
      const startVal = parts[0];
      const endVal = parts[1];
      
      const selectedEmp = selectDipendente ? selectDipendente.value : '';
      let url = `${API_BASE}/api/reports/export-period?start=${startVal}&end=${endVal}&highlightViola=false`;
      if (selectedEmp) {
        url += `&employee=${encodeURIComponent(selectedEmp)}`;
      }
      
      window.open(url, '_blank');
      showToast('Compilazione e download del foglio Excel consolidato avviati.', 'success');
    });
  }

  if (btnExportHighlighted) {
    btnExportHighlighted.addEventListener('click', () => {
      if (!select || !select.value) return;
      const parts = select.value.split('|');
      const startVal = parts[0];
      const endVal = parts[1];
      
      const selectedEmp = selectDipendente ? selectDipendente.value : '';
      let url = `${API_BASE}/api/reports/export-period?start=${startVal}&end=${endVal}&highlightViola=true`;
      if (selectedEmp) {
        url += `&employee=${encodeURIComponent(selectedEmp)}`;
      }
      
      window.open(url, '_blank');
      showToast('Compilazione e download del foglio Excel consolidato (evidenziato) avviati.', 'success');
    });
  }
}

function populateBimestreDropdown() {
  const select = document.getElementById('select-bimestre');
  if (!select) return;

  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Generate for currentYear - 1, currentYear, and currentYear + 1
  const years = [currentYear - 1, currentYear, currentYear + 1];
  const bimestriNames = [
    { label: 'Gennaio - Febbraio', start: 1, end: 2 },
    { label: 'Marzo - Aprile', start: 3, end: 4 },
    { label: 'Maggio - Giugno', start: 5, end: 6 },
    { label: 'Luglio - Agosto', start: 7, end: 8 },
    { label: 'Settembre - Ottobre', start: 9, end: 10 },
    { label: 'Novembre - Dicembre', start: 11, end: 12 }
  ];

  let html = '';
  years.forEach(year => {
    bimestriNames.forEach((bim) => {
      const startVal = `${year}-${String(bim.start).padStart(2, '0')}`;
      const endVal = `${year}-${String(bim.end).padStart(2, '0')}`;
      html += `<option value="${startVal}|${endVal}">${bim.label} ${year}</option>`;
    });
  });

  select.innerHTML = html;

  // Set default active based on current date or localStorage
  let saved = localStorage.getItem('rimborsi_admin_bimestre');
  if (!saved) {
    // Determine current bimestre
    const month = now.getMonth(); // 0-based
    let bimIdx = Math.floor(month / 2);
    const bim = bimestriNames[bimIdx];
    const startVal = `${currentYear}-${String(bim.start).padStart(2, '0')}`;
    const endVal = `${currentYear}-${String(bim.end).padStart(2, '0')}`;
    saved = `${startVal}|${endVal}`;
    localStorage.setItem('rimborsi_admin_bimestre', saved);
  }

  select.value = saved;

  select.addEventListener('change', () => {
    localStorage.setItem('rimborsi_admin_bimestre', select.value);
    renderReportsTable();
  });
}

function openLightbox(src) {
  const lightbox = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  if (!lightbox || !img) return;
  img.src = src;
  lightbox.classList.add('active');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox-modal');
  if (lightbox) lightbox.classList.remove('active');
}

window.openAttachmentDirectly = function(reportId, fileName, isPdf) {
  const fileUrl = `${API_BASE}/uploads/${reportId}/${fileName}`;
  if (isPdf) {
    window.open(fileUrl, '_blank');
  } else {
    openLightbox(fileUrl);
  }
};

window.closeLightbox = closeLightbox;

async function fetchAndRenderTrash() {
  const trashList = document.getElementById('trash-list');
  if (!trashList) return;

  trashList.innerHTML = `
    <tr>
      <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">
        <i class="fa-solid fa-spinner spinner" style="margin-right:4px;"></i> Caricamento cestino...
      </td>
    </tr>
  `;

  try {
    const response = await fetch(`${API_BASE}/api/trash`);
    if (!response.ok) throw new Error('Impossibile caricare il cestino.');
    const trash = await response.json();

    if (trash.length === 0) {
      trashList.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary); font-style: italic;">
            Il cestino è vuoto.
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    trash.forEach(report => {
      const delDateStr = new Date(report.deletedAt).toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      html += `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 10px 12px; font-weight:600; color:#fff;">${report.employee}</td>
          <td style="padding: 10px 12px;">${report.period}</td>
          <td style="padding: 10px 12px; color: var(--text-muted);">${delDateStr}</td>
          <td style="padding: 10px 12px; font-weight:600; color: ${report.daysRemaining <= 10 ? 'var(--danger)' : 'var(--warning)'};">${report.daysRemaining} giorni</td>
          <td style="padding: 10px 12px; text-align: right;">
            <button class="btn btn-primary btn-sm restore-btn" data-id="${report.id}" style="padding: 4px 8px; font-size:11px;">
              <i class="fa-solid fa-rotate-left"></i> Ripristina
            </button>
          </td>
        </tr>
      `;
    });

    trashList.innerHTML = html;

    // Bind restore click listeners
    trashList.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await restoreReport(id);
      });
    });
  } catch (error) {
    console.error(error);
    trashList.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px; color: var(--danger);">
          Errore nel recupero dati: ${error.message}
        </td>
      </tr>
    `;
  }
}

async function restoreReport(reportId) {
  try {
    const response = await fetch(`${API_BASE}/api/trash/${reportId}/restore`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Errore durante il ripristino.');

    showToast('Nota spese ripristinata con successo!', 'success');
    
    // Refresh trash list
    await fetchAndRenderTrash();
    
    // Refresh main submissions table
    fetchReports();
  } catch (error) {
    console.error(error);
    showToast(`Errore: ${error.message}`, 'danger');
  }
}

function openViolaModal() {
  const modal = document.getElementById('viola-modal');
  const listContainer = document.getElementById('viola-list');
  if (!modal || !listContainer) return;

  listContainer.innerHTML = '';
  const violaEntries = filteredEntries.filter(e => e.color === 'viola');

  if (violaEntries.length === 0) {
    listContainer.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
          Nessuna voce flaggata Viola Tenue trovata per la selezione corrente.
        </td>
      </tr>
    `;
  } else {
    violaEntries.forEach(entry => {
      const row = document.createElement('tr');
      const dateFormatted = entry.date ? entry.date.split('-').reverse().join('/') : '';
      const isGiustificativo = entry.reimbursementType === 'giustificativo';
      const kmRefund = (!isGiustificativo && entry.type === 'trasferta') ? (Number(entry.km) || 0) * (Number(entry.profile.costKm) || 0) : 0;
      const entryTotal = isGiustificativo ? 0 : ((Number(entry.flatRate) || 0) + (Number(entry.tolls) || 0) + kmRefund + (Number(entry.other) || 0));
      const moneyFormatted = entryTotal.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

      row.innerHTML = `
        <td style="padding: 10px 12px;">${dateFormatted}</td>
        <td style="padding: 10px 12px; font-weight: 500;">${entry.client || ''}</td>
        <td style="padding: 10px 12px;">
          <span class="badge ${entry.type === 'trasferta' ? 'badge-primary' : (isGiustificativo ? 'badge-outline' : 'badge-secondary')}" style="font-size: 10px; padding: 2px 4px;">
            ${entry.type === 'trasferta' ? 'Trasferta' : (isGiustificativo ? 'Giustificativo' : 'Solo Spesa')}
          </span>
        </td>
        <td style="padding: 10px 12px; max-width: 250px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${entry.description || ''}">${entry.description || ''}</td>
        <td style="padding: 10px 12px; text-align: center;">${entry.type === 'trasferta' && entry.km ? entry.km : '-'}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: bold; color: var(--success);">${moneyFormatted}</td>
      `;
      listContainer.appendChild(row);
    });
  }

  modal.classList.add('active');
}

function setupViolaModalHandlers() {
  const modal = document.getElementById('viola-modal');
  const closeBtn1 = document.getElementById('viola-modal-close');
  const closeBtn2 = document.getElementById('viola-modal-close-btn');
  const btnExportViola = document.getElementById('btn-export-viola');
  const select = document.getElementById('select-bimestre');
  const selectDipendente = document.getElementById('select-dipendente');

  if (!modal) return;

  const closeModal = () => modal.classList.remove('active');

  if (closeBtn1) closeBtn1.addEventListener('click', closeModal);
  if (closeBtn2) closeBtn2.addEventListener('click', closeModal);

  if (btnExportViola) {
    btnExportViola.addEventListener('click', () => {
      if (!select || !select.value) return;
      const parts = select.value.split('|');
      const startVal = parts[0];
      const endVal = parts[1];
      
      const selectedEmp = selectDipendente ? selectDipendente.value : '';
      let url = `${API_BASE}/api/reports/export-period?start=${startVal}&end=${endVal}&onlyViola=true`;
      if (selectedEmp) {
        url += `&employee=${encodeURIComponent(selectedEmp)}`;
      }
      
      window.open(url, '_blank');
      showToast('Download del foglio Excel delle sole voci Viola avviato.', 'success');
    });
  }
}
