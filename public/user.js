const API_BASE = (window.location.protocol === 'file:') 
  ? 'http://localhost:3000' 
  : '';

let profileState = {
  surname: 'MARTINELLI',
  name: 'Luca',
  company: 'Mayonese S.R.L.',
  address: 'Strada Naviglio Alto 46/1, 42122, Parma (PR) ',
  period: '',
  carModel: 'Tesla elettrica H5LD Model 3',
  plate: 'GX477ZP',
  engine: '1.600 cm³   /  80,56 kW ',
  fuel: 'Elettrica',
  costKm: 0.40,
  flatRateRate: 15.00
};

let entriesState = [];
// Store actual File objects separately since they can't be JSON serialized
let fileObjectsMap = {}; 
let autocompleteTimeout = null;

const ORIGIN_LAT = 44.8219;
const ORIGIN_LON = 10.3117;
const ORIGIN_NAME = 'Mayonese S.R.L., Parma';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadDraft();
  setupProfileListeners();
  setupProfileToggle();
  setupGlobalListeners();
  setupTabs();
  setupLightbox();
  renderEntries();
});

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

// --- Persistence (Drafts) ---
function saveDraft() {
  const dataToSave = {
    profile: profileState,
    entries: entriesState.map(entry => ({
      ...entry,
      attachments: entry.attachments.map(att => ({
        id: att.id,
        name: att.name,
        type: att.type,
        size: att.size,
        fileName: att.fileName,
        isUploaded: att.isUploaded
      }))
    }))
  };
  localStorage.setItem('rimborsi_v2_draft', JSON.stringify(dataToSave));
}

function loadDraft() {
  const savedDraft = localStorage.getItem('rimborsi_v2_draft');
  if (savedDraft) {
    try {
      const parsed = JSON.parse(savedDraft);
      if (parsed.profile) profileState = { ...profileState, ...parsed.profile };
      if (parsed.entries) {
        entriesState = parsed.entries.map(entry => ({
          ...entry,
          attachments: (entry.attachments || []).map(att => ({
            ...att,
            file: null // Actual File object is missing, user will need to re-upload if they want to submit files
          }))
        }));
      }
    } catch (e) {
      console.error('Failed to parse draft from local storage:', e);
    }
  } else {
    // Generate an empty period based on current month
    const now = new Date();
    const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    // Default period: Current and previous month (Bimestre)
    const prevMonthIdx = (now.getMonth() - 1 + 12) % 12;
    const currentMonthIdx = now.getMonth();
    const year = now.getFullYear();
    profileState.period = `01/${String(prevMonthIdx + 1).padStart(2, '0')}/${String(year).substring(2)} - 31/${String(currentMonthIdx + 1).padStart(2, '0')}/${String(year).substring(2)}`;
  }

  // Populate UI inputs with profile state
  document.getElementById('prof-surname').value = profileState.surname;
  document.getElementById('prof-name').value = profileState.name;
  document.getElementById('prof-address').value = profileState.address;
  document.getElementById('prof-carmodel').value = profileState.carModel;
  document.getElementById('prof-plate').value = profileState.plate;
  document.getElementById('prof-engine').value = profileState.engine;
  document.getElementById('prof-fuel').value = profileState.fuel;
  document.getElementById('prof-costkm').value = profileState.costKm;
  document.getElementById('prof-flatrate').value = profileState.flatRateRate;
}

let isProfileEditable = false;

// --- Profile Lock/Unlock Toggle ---
function setupProfileToggle() {
  const editBtn = document.getElementById('edit-profile-btn');
  const profileInputs = [
    'prof-surname', 'prof-name', 'prof-address',
    'prof-carmodel', 'prof-plate', 'prof-engine', 'prof-fuel', 'prof-costkm', 'prof-flatrate'
  ];

  if (!editBtn) return;

  editBtn.addEventListener('click', () => {
    isProfileEditable = !isProfileEditable;

    profileInputs.forEach(id => {
      const input = document.getElementById(id);
      if (input) {
        input.disabled = !isProfileEditable;
      }
    });

    if (isProfileEditable) {
      editBtn.innerHTML = '<i class="fa-solid fa-lock-open"></i> Blocca';
      editBtn.classList.remove('btn-secondary');
      editBtn.classList.add('btn-primary');
      showToast('Profilo sbloccato per la modifica', 'info');
    } else {
      editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Modifica';
      editBtn.classList.remove('btn-primary');
      editBtn.classList.add('btn-secondary');
      
      // Recalculate flat rates for all trasferte since flatRateRate might have changed
      entriesState.forEach(entry => {
        if (entry.type === 'trasferta') {
          let days = 1;
          if (entry.date && entry.endDate) {
            const start = new Date(entry.date);
            const end = new Date(entry.endDate);
            if (!isNaN(start) && !isNaN(end) && end >= start) {
              days = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
            }
          }
          entry.flatRate = days * (Number(profileState.flatRateRate) || 0);
        }
      });

      saveDraft();
      renderEntries(); // Refresh UI values
      showToast('Profilo salvato e rimborsi forfettari ricalcolati', 'success');
    }
  });
}

// --- Listeners for Profile Settings ---
function setupProfileListeners() {
  const profileInputs = [
    { id: 'prof-surname', field: 'surname', format: val => val.toUpperCase() },
    { id: 'prof-name', field: 'name' },
    { id: 'prof-address', field: 'address' },
    { id: 'prof-carmodel', field: 'carModel' },
    { id: 'prof-plate', field: 'plate', format: val => val.toUpperCase() },
    { id: 'prof-engine', field: 'engine' },
    { id: 'prof-fuel', field: 'fuel' },
    { id: 'prof-costkm', field: 'costKm', format: val => parseFloat(val) || 0 },
    { id: 'prof-flatrate', field: 'flatRateRate', format: val => parseFloat(val) || 0 }
  ];

  profileInputs.forEach(input => {
    const element = document.getElementById(input.id);
    if (!element) return;
    
    element.addEventListener('input', (e) => {
      let val = e.target.value;
      if (input.format) val = input.format(val);
      profileState[input.field] = val;
      saveDraft();
      
      // Update attachments renaming preview on card elements in real-time
      updateAllCardAttachmentPreviews();
    });
  });
}

// --- Listeners for Global Actions ---
function setupGlobalListeners() {
  document.getElementById('add-trasferta-btn').addEventListener('click', () => addEntry('trasferta'));
  document.getElementById('add-spesa-btn').addEventListener('click', () => addEntry('spesa'));
  
  document.getElementById('clear-all-btn').addEventListener('click', () => {
    if (confirm('Sei sicuro di voler cancellare tutte le spese inserite?')) {
      entriesState = [];
      fileObjectsMap = {};
      saveDraft();
      renderEntries();
      showToast('Tutte le spese sono state rimosse', 'info');
    }
  });

  document.getElementById('save-draft-btn').addEventListener('click', () => {
    saveDraft();
    showToast('Bozza salvata in locale con successo!', 'success');
  });

  document.getElementById('submit-report-btn').addEventListener('click', submitReport);

  // Excel Preview button listener
  const previewExcelBtn = document.getElementById('preview-excel-btn');
  if (previewExcelBtn) {
    previewExcelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (entriesState.length === 0) {
        showToast("Nessuna spesa inserita da visualizzare in anteprima.", "warning");
        return;
      }
      const fakeReport = {
        profile: { ...profileState },
        items: entriesState
      };
      showExcelPreview(fakeReport);
    });
  }

  const excelModal = document.getElementById('excel-preview-modal');
  const excelClose = document.getElementById('excel-preview-close');
  const excelCloseBtn = document.getElementById('excel-preview-close-btn');
  if (excelModal) {
    const hideExcelModal = () => excelModal.classList.remove('active');
    if (excelClose) excelClose.addEventListener('click', hideExcelModal);
    if (excelCloseBtn) excelCloseBtn.addEventListener('click', hideExcelModal);
  }
}

// --- Entry Management ---
function addEntry(type) {
  const id = 'entry-' + Date.now() + '-' + Math.round(Math.random() * 1000);
  const todayStr = new Date().toISOString().split('T')[0];

  const newEntry = {
    id,
    type,
    reimbursementType: 'rimborso', // 'rimborso' or 'giustificativo'
    date: todayStr,
    endDate: todayStr,
    client: '',
    description: '', // Used as 'tratta' or 'descrizione spesa'
    flatRate: type === 'trasferta' ? profileState.flatRateRate : 0,
    tolls: 0,
    km: type === 'trasferta' ? '' : undefined,
    other: 0,
    attachments: []
  };

  entriesState.push(newEntry);
  saveDraft();
  renderEntries();
  showToast(`Aggiunta nuova riga di tipo: ${type.toUpperCase()}`, 'success');

  // Scroll to new entry
  const element = document.querySelector(`.expense-card[data-id="${id}"]`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function deleteEntry(id) {
  entriesState = entriesState.filter(e => e.id !== id);
  // Clean file objects map
  delete fileObjectsMap[id];
  saveDraft();
  renderEntries();
  showToast('Spesa rimossa', 'info');
}

function duplicateEntry(id) {
  const original = entriesState.find(e => e.id === id);
  if (!original) return;

  const duplicatedId = 'entry-' + Date.now() + '-' + Math.round(Math.random() * 1000);
  const duplicated = {
    ...JSON.parse(JSON.stringify(original)), // Deep clone
    id: duplicatedId,
    attachments: [] // Do not copy files
  };

  const idx = entriesState.findIndex(e => e.id === id);
  entriesState.splice(idx + 1, 0, duplicated);

  saveDraft();
  renderEntries();
  showToast('Spesa duplicata', 'success');
}

// --- UI Rendering ---
function renderEntries() {
  const container = document.getElementById('expenses-list');
  const emptyState = document.getElementById('empty-state');

  // Remove existing cards
  const existingCards = container.querySelectorAll('.expense-card');
  existingCards.forEach(card => card.remove());

  if (entriesState.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  entriesState.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = `expense-card ${entry.color === 'viola' ? 'viola-highlight' : ''}`;
    card.setAttribute('data-id', entry.id);

    const titleIcon = entry.type === 'trasferta' 
      ? '<i class="fa-solid fa-car" style="color: var(--primary);"></i> TRASFERTA'
      : '<i class="fa-solid fa-receipt" style="color: var(--accent);"></i> SPESA GENERICA';

    let datesHtml = '';
    let amountFieldsHtml = '';

    if (entry.type === 'trasferta') {
      datesHtml = `
        <div class="grid-fields-2">
          <div class="form-group">
            <label>Data Inizio</label>
            <input type="date" class="form-input date-input" value="${entry.date || ''}">
          </div>
          <div class="form-group">
            <label>Data Fine</label>
            <input type="date" class="form-input end-date-input" value="${entry.endDate || entry.date || ''}">
          </div>
        </div>
      `;

      amountFieldsHtml = `
        <div class="form-group">
          <label>Rimborso Forfettario (€)</label>
          <input type="number" class="form-input flatrate-input" value="${entry.flatRate !== undefined ? entry.flatRate : 0}" step="0.5">
        </div>
        <div class="grid-fields-2">
          <div class="form-group">
            <label>Pedaggi / Autostrada (€)</label>
            <input type="number" class="form-input tolls-input" value="${entry.tolls !== undefined ? entry.tolls : 0}" step="0.5">
          </div>
          <div class="form-group">
            <label>Altro (€)</label>
            <input type="number" class="form-input other-input" value="${entry.other !== undefined ? entry.other : 0}" step="0.5">
          </div>
        </div>
      `;
    } else {
      datesHtml = `
        <div class="form-group">
          <label>Data Spesa</label>
          <input type="date" class="form-input date-input" value="${entry.date || ''}">
        </div>
      `;

      amountFieldsHtml = `
        <div class="form-group">
          <label>Totale Spesa (€)</label>
          <input type="number" class="form-input other-input" value="${entry.other !== undefined ? entry.other : 0}" step="0.5">
        </div>
      `;
    }

    let typeSelectHtml = `
      <div class="form-group">
        <label>Tipo Spesa</label>
        <select class="form-select type-select">
          <option value="trasferta" ${entry.type === 'trasferta' ? 'selected' : ''}>Trasferta</option>
          <option value="spesa" ${entry.type === 'spesa' ? 'selected' : ''}>Solo Spesa</option>
        </select>
      </div>
    `;

    if (entry.type === 'spesa') {
      typeSelectHtml += `
        <div class="form-group">
          <label>Categoria Spesa</label>
          <select class="form-select reimbursement-type-select">
            <option value="rimborso" ${entry.reimbursementType !== 'giustificativo' ? 'selected' : ''}>Rimborso Amministratore (RA)</option>
            <option value="giustificativo" ${entry.reimbursementType === 'giustificativo' ? 'selected' : ''}>Giustificativo (G)</option>
          </select>
        </div>
      `;
    }

    let cardHtml = `
      <div class="card-top" style="border-bottom: 1px solid ${entry.color === 'viola' ? 'rgba(168, 85, 247, 0.25)' : 'var(--border-color)'};">
        <div style="display:flex; align-items:center;">
          <span class="card-index-badge" style="background: ${entry.color === 'viola' ? '#a855f7' : 'var(--primary)'};">#${index + 1}</span>
          <span style="font-weight:600; margin-left:8px; font-size:13px; letter-spacing:0.05em; text-transform:uppercase;">${titleIcon}</span>
        </div>
        
        <!-- Color Selector dots -->
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:10px; color: var(--text-muted);">Colore:</span>
          <button class="color-dot-btn ${entry.color !== 'viola' ? 'active' : ''}" data-color="classic" title="Classico" style="width:16px; height:16px; border-radius:50%; border:2px solid ${entry.color !== 'viola' ? '#ffffff' : 'transparent'}; background: var(--primary); cursor:pointer; padding:0; outline:none; transition: all 0.2s;"></button>
          <button class="color-dot-btn ${entry.color === 'viola' ? 'active' : ''}" data-color="viola" title="Viola Tenue" style="width:16px; height:16px; border-radius:50%; border:2px solid ${entry.color === 'viola' ? '#ffffff' : 'transparent'}; background: #c084fc; cursor:pointer; padding:0; outline:none; transition: all 0.2s;"></button>
        </div>

        <div class="card-actions">
          <button class="btn btn-outline btn-icon-only btn-sm duplicate-btn" title="Duplica"><i class="fa-solid fa-clone"></i></button>
          <button class="btn btn-danger btn-icon-only btn-sm delete-btn" title="Elimina"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>

      ${datesHtml}
      
      <div style="display: grid; grid-template-columns: ${entry.type === 'spesa' ? '2fr 1fr 1fr' : '1fr 1fr'}; gap: 12px;">
        <div class="form-group">
          <label>Cliente / Progetto</label>
          <input type="text" class="form-input client-input" value="${entry.client || ''}" placeholder="Cliente/Sito">
        </div>
        ${typeSelectHtml}
      </div>
    `;

    if (entry.type === 'trasferta') {
      cardHtml += `
        <div class="grid-fields-2">
          <div class="form-group">
            <label>Tratta (Destinazione)</label>
            <div style="display:flex; gap:6px; position: relative;">
              <div style="flex-grow: 1; position: relative;" class="autocomplete-wrapper">
                <input type="text" class="form-input description-input" style="width: 100%;" value="${entry.description || ''}" placeholder="Es. Bologna via dei Mille">
                <div class="autocomplete-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: #1f1b2e; border: 1px solid var(--border-color); border-radius: 8px; z-index: 1000; max-height: 200px; overflow-y: auto; box-shadow: var(--card-shadow);"></div>
              </div>
              <button class="btn btn-secondary btn-sm calc-km-btn" style="flex-shrink:0;"><i class="fa-solid fa-route"></i> Calcola KM</button>
            </div>
          </div>
          <div class="form-group">
            <label>Distanza KM A/R</label>
            <input type="number" class="form-input km-input" value="${entry.km !== undefined ? entry.km : ''}" placeholder="KM Totali">
          </div>
        </div>
        <div class="route-calculator-zone" style="display:none;"></div>
      `;
    } else {
      cardHtml += `
        <div class="form-group">
          <label>Descrizione Spesa</label>
          <input type="text" class="form-input description-input" value="${entry.description || ''}" placeholder="Es. Acquisto cancelleria o marca da bollo">
        </div>
      `;
    }

    cardHtml += amountFieldsHtml;

    cardHtml += `
      <!-- File Attachment Zone -->
      <div class="card-attachments-list">
        <div class="uploader-zone">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <p>Trascina le ricevute qui o clicca per caricare</p>
          <span>Supporta PDF, PNG, JPG (Parcheggio, Autostrada, Telepass)</span>
          <input type="file" multiple class="file-picker-input" style="display:none;">
        </div>
        <div class="attachments-items-container"></div>

        <!-- Extracted Data Table -->
        <div class="extracted-table-container" style="display:none; margin-top:16px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 14px;">
          <span style="font-size:11px; font-weight:600; color:#fff; display:block; margin-bottom:8px;">
            <i class="fa-solid fa-square-poll-horizontal" style="color:var(--primary); margin-right:4px;"></i> Dati Rilevati dagli Allegati
          </span>
          <div class="inner-table-container" style="overflow-x:auto; border: 1px solid var(--border-color); border-radius:6px;">
            <table class="inner-table" style="width:100%; border-collapse:collapse; font-size:10px;">
              <thead>
                <tr style="background:rgba(0,0,0,0.3); text-align:left; color: var(--text-secondary);">
                  <th style="padding:4px 6px;">File</th>
                  <th style="padding:4px 6px;">Tipo Rilevato</th>
                  <th style="padding:4px 6px;">Data</th>
                  <th style="padding:4px 6px; text-align:right;">Importo</th>
                </tr>
              </thead>
              <tbody class="extracted-table-body">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    card.innerHTML = cardHtml;
    container.appendChild(card);

    // Render attachments inside card
    renderCardAttachments(entry, card);

    // Bind event listeners for card inputs
    bindCardListeners(entry, card);
  });
}

function renderCardAttachments(entry, cardElement) {
  const container = cardElement.querySelector('.attachments-items-container');
  const tableContainer = cardElement.querySelector('.extracted-table-container');
  const tableBody = cardElement.querySelector('.extracted-table-body');

  container.innerHTML = '';
  if (tableBody) tableBody.innerHTML = '';
  if (tableContainer) tableContainer.style.display = 'none';

  if (!entry.attachments || entry.attachments.length === 0) {
    entry.extractedData = []; // Clear data if attachments deleted
    return;
  }

  entry.attachments.forEach((att, idx) => {
    const item = document.createElement('div');
    item.className = 'attachment-item';

    const extension = att.name.split('.').pop().toLowerCase();
    let fileIcon = 'fa-file-invoice';
    if (extension === 'pdf') fileIcon = 'fa-file-pdf';
    else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) fileIcon = 'fa-file-image';

    const hasFile = att.isUploaded || (fileObjectsMap[entry.id] && fileObjectsMap[entry.id][att.id]) || att.file;
    const sizeFormatted = att.size ? (att.size / 1024).toFixed(1) + ' KB' : '';

    const isUploading = att.uploading;
    let controlsHtml = '';
    
    if (isUploading) {
      controlsHtml = `
        <span style="font-size:10px; color:var(--text-secondary); display:inline-flex; align-items:center; gap:4px; margin-right: 6px;">
          <i class="fa-solid fa-spinner spinner" style="color: var(--primary);"></i> Upload...
        </span>
        <button class="btn btn-danger btn-icon-only btn-sm delete-file-btn" style="width:22px; height:22px;" title="Rimuovi"><i class="fa-solid fa-xmark"></i></button>
      `;
    } else {
      controlsHtml = `
        <select class="file-type-select">
          <option value="generico" ${att.type === 'generico' ? 'selected' : ''}>Generico</option>
          <option value="telepass" ${att.type === 'telepass' ? 'selected' : ''}>Telepass</option>
          <option value="autostrada" ${att.type === 'autostrada' ? 'selected' : ''}>Autostrada</option>
          <option value="parcheggio" ${att.type === 'parcheggio' ? 'selected' : ''}>Parcheggio</option>
          <option value="pasto" ${att.type === 'pasto' ? 'selected' : ''}>Pasto</option>
        </select>
        <button class="btn btn-outline btn-icon-only btn-sm preview-file-btn" style="width:22px; height:22px;" title="Anteprima"><i class="fa-solid fa-eye"></i></button>
        <button class="btn btn-outline btn-icon-only btn-sm analyze-file-btn" style="width:22px; height:22px;" title="Analizza Spesa (OCR)"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
        <button class="btn btn-danger btn-icon-only btn-sm delete-file-btn" style="width:22px; height:22px;" title="Rimuovi"><i class="fa-solid fa-xmark"></i></button>
      `;
    }

    item.innerHTML = `
      <div class="attachment-meta">
        <div class="attachment-name-section" title="${att.name}">
          <i class="fa-solid ${fileIcon}"></i>
          <div style="display:flex; flex-direction:column; overflow:hidden;">
            <strong style="font-size:11px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${att.name}</strong>
            <span style="font-size:9px; color:var(--text-muted);">${sizeFormatted} ${!hasFile ? '(<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning);"></i> ricaricare)' : ''}</span>
          </div>
        </div>
        <div class="attachment-controls">
          ${controlsHtml}
        </div>
      </div>
      <div class="renamed-preview-box">
        <i class="fa-solid fa-reply"></i>
        <span>${getRenamedFilenamePreview(entry, att)}</span>
      </div>
    `;

    if (!isUploading) {
      // File preview button handler
      const previewBtn = item.querySelector('.preview-file-btn');
      previewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const fileObj = (fileObjectsMap[entry.id] && fileObjectsMap[entry.id][att.id]) || att.file;
        if (fileObj) {
          const extension = fileObj.name.split('.').pop().toLowerCase();
          const objectUrl = URL.createObjectURL(fileObj);
          if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
            showLightbox(objectUrl, fileObj.name);
          } else {
            window.open(objectUrl, '_blank');
          }
        } else if (att.isUploaded && att.fileName) {
          const fileUrl = `${API_BASE}/uploads/temp/${att.fileName}`;
          const extension = att.name.split('.').pop().toLowerCase();
          if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
            showLightbox(fileUrl, att.name);
          } else {
            window.open(fileUrl, '_blank');
          }
        } else {
          showToast("Ricarica il file per poterne vedere l'anteprima.", "warning");
        }
      });

      // File analyze button handler
      const analyzeBtn = item.querySelector('.analyze-file-btn');
      analyzeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!att.isUploaded || !att.fileName) {
          showToast("Il file non è stato ancora caricato sul server. Attendi un momento.", "warning");
          return;
        }

        analyzeBtn.innerHTML = '<i class="fa-solid fa-spinner spinner"></i>';
        analyzeBtn.disabled = true;

        try {
          const res = await fetch(`${API_BASE}/api/analyze-attachment`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fileName: att.fileName,
              originalName: att.name
            })
          });

          if (!res.ok) throw new Error("Errore durante l'analisi del file.");
          const result = await res.json();

          if (result.success) {
            // 1. Update attachment type
            att.type = result.type;
            
            if (result.date) {
              if (!entry.date) {
                entry.date = result.date;
                entry.endDate = result.date;
                const dateInput = cardElement.querySelector('.date-input');
                const endDateInput = cardElement.querySelector('.end-date-input');
                if (dateInput) dateInput.value = result.date;
                if (endDateInput) endDateInput.value = result.date;
              } else {
                verifyDocumentDateCongruency(entry, att.name, result.date);
              }
            }

            if (result.client && result.client !== 'Cliente Generico') {
              entry.client = result.client;
              const clientInput = cardElement.querySelector('.client-input');
              if (clientInput) clientInput.value = result.client;
            }

            // 2. Save extracted data to entry
            entry.extractedData = entry.extractedData || [];
            const extObj = {
              attId: att.id,
              fileName: att.name,
              type: result.type,
              date: result.date,
              total: result.total
            };
            
            const existingIdx = entry.extractedData.findIndex(d => d.attId === att.id);
            if (existingIdx !== -1) {
              entry.extractedData[existingIdx] = extObj;
            } else {
              entry.extractedData.push(extObj);
            }

            // 3. Recalculate sums
            recalculateExtractedTotals(entry, cardElement);

            saveDraft();
            if (result.total !== null) {
              showToast(`Analisi completata! Rilevato importo: €${result.total.toFixed(2)}`, 'success');
            } else {
              showToast(`Analisi completata! Importo non rilevato automaticamente, inseriscilo manualmente.`, 'warning');
            }
            
            // Re-render attachments to update tables
            renderCardAttachments(entry, cardElement);
          }
        } catch (err) {
          console.error(err);
          showToast(err.message, 'danger');
        } finally {
          analyzeBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
          analyzeBtn.disabled = false;
        }
      });

      // File type select change
      item.querySelector('.file-type-select').addEventListener('change', (e) => {
        att.type = e.target.value;
        saveDraft();
        item.querySelector('.renamed-preview-box span').innerText = getRenamedFilenamePreview(entry, att);
        
        // Recalculate sums on manual dropdown change
        recalculateExtractedTotals(entry, cardElement);
      });
    }

    // File delete button
    item.querySelector('.delete-file-btn').addEventListener('click', () => {
      entry.attachments = entry.attachments.filter(a => a.id !== att.id);
      if (fileObjectsMap[entry.id]) {
        delete fileObjectsMap[entry.id][att.id];
      }
      entry.extractedData = (entry.extractedData || []).filter(d => d.attId !== att.id);
      
      // Recalculate sums on deletion
      recalculateExtractedTotals(entry, cardElement);
      
      saveDraft();
      renderCardAttachments(entry, cardElement);
    });

    container.appendChild(item);
  });

  // Populate extracted data table
  if (entry.extractedData && entry.extractedData.length > 0 && tableContainer && tableBody) {
    entry.extractedData.forEach(d => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      
      const dateFormatted = d.date ? d.date.split('-').reverse().join('/') : '-';
      const amountFormatted = d.total !== null ? parseFloat(d.total).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : '-';

      tr.innerHTML = `
        <td style="padding:4px 6px; font-weight:500; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:120px;" title="${d.fileName}">${d.fileName}</td>
        <td style="padding:4px 6px; text-transform:capitalize;">${d.type}</td>
        <td style="padding:4px 6px;">${dateFormatted}</td>
        <td style="padding:4px 6px; text-align:right; font-weight:600; color:var(--success);">${amountFormatted}</td>
      `;
      tableBody.appendChild(tr);
    });
    tableContainer.style.display = 'block';
  }
}

function recalculateExtractedTotals(entry, cardElement) {
  let sumTolls = 0;
  let sumOther = 0;

  (entry.extractedData || []).forEach(d => {
    const att = entry.attachments.find(a => a.id === d.attId);
    const currentType = att ? att.type : d.type;

    if (d.total !== null) {
      if (currentType === 'telepass' || currentType === 'autostrada') {
        sumTolls += d.total;
      } else {
        sumOther += d.total;
      }
    }
  });

  entry.tolls = parseFloat(sumTolls.toFixed(2));
  entry.other = parseFloat(sumOther.toFixed(2));

  const tollsInput = cardElement.querySelector('.tolls-input');
  const otherInput = cardElement.querySelector('.other-input');

  if (tollsInput) tollsInput.value = entry.tolls;
  if (otherInput) otherInput.value = entry.other;
}

function verifyDocumentDateCongruency(entry, attName, docDateStr) {
  if (!docDateStr || !entry.date) return true;

  const docDate = new Date(docDateStr);
  if (isNaN(docDate)) return true;
  docDate.setHours(0,0,0,0);

  if (entry.type === 'trasferta') {
    const start = new Date(entry.date);
    const end = new Date(entry.endDate || entry.date);
    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    
    if (docDate < start || docDate > end) {
      const startFmt = start.toLocaleDateString('it-IT');
      const endFmt = end.toLocaleDateString('it-IT');
      const docFmt = docDate.toLocaleDateString('it-IT');
      alert(`Attenzione!\nLa data rilevata nel documento "${attName}" (${docFmt}) non rientra nel periodo della trasferta (${startFmt} - ${endFmt}).`);
      return false;
    }
  } else {
    const start = new Date(entry.date);
    start.setHours(0,0,0,0);
    const docTime = docDate.getTime();
    const startTime = start.getTime();
    
    if (docTime !== startTime) {
      const startFmt = start.toLocaleDateString('it-IT');
      const docFmt = docDate.toLocaleDateString('it-IT');
      alert(`Attenzione!\nLa data rilevata nel documento "${attName}" (${docFmt}) non corrisponde alla data della spesa (${startFmt}).`);
      return false;
    }
  }
  return true;
}

function verifyAllCardDocumentsCongruency(entry) {
  if (!entry.extractedData || entry.extractedData.length === 0) return;
  entry.extractedData.forEach(d => {
    if (d.date) {
      verifyDocumentDateCongruency(entry, d.fileName, d.date);
    }
  });
}

function updateCardFlatRateFromDates(entry, cardElement) {
  if (entry.type !== 'trasferta') return;

  const flatRateInput = cardElement.querySelector('.flatrate-input');
  if (!flatRateInput) return;

  let days = 1;
  if (entry.date && entry.endDate) {
    const start = new Date(entry.date);
    const end = new Date(entry.endDate);
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      days = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1; // inclusive
    }
  }

  const rate = Number(profileState.flatRateRate) || 0;
  const calculatedFlatRate = days * rate;

  entry.flatRate = calculatedFlatRate;
  flatRateInput.value = calculatedFlatRate;
}

function updateAllCardAttachmentPreviews() {
  entriesState.forEach(entry => {
    const card = document.querySelector(`.expense-card[data-id="${entry.id}"]`);
    if (!card) return;
    
    const container = card.querySelector('.attachments-items-container');
    if (!container) return;
    
    const items = container.querySelectorAll('.attachment-item');
    entry.attachments.forEach((att, idx) => {
      const item = items[idx];
      if (item) {
        item.querySelector('.renamed-preview-box span').innerText = getRenamedFilenamePreview(entry, att);
      }
    });
  });
}

// --- Event Binding ---
function bindCardListeners(entry, cardElement) {
  // Delete card
  cardElement.querySelector('.delete-btn').addEventListener('click', () => {
    deleteEntry(entry.id);
  });

  // Duplicate card
  cardElement.querySelector('.duplicate-btn').addEventListener('click', () => {
    duplicateEntry(entry.id);
  });

  // Color selection
  cardElement.querySelectorAll('.color-dot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const color = btn.getAttribute('data-color');
      entry.color = color;
      saveDraft();
      renderEntries();
    });
  });

  // Date input live change
  cardElement.querySelector('.date-input').addEventListener('change', (e) => {
    const oldStartDate = entry.date;
    entry.date = e.target.value;

    // Auto-fill end date if it matches old start date or is empty
    const endDateInput = cardElement.querySelector('.end-date-input');
    if (endDateInput && (!entry.endDate || entry.endDate === oldStartDate)) {
      entry.endDate = e.target.value;
      endDateInput.value = e.target.value;
    }

    // Recalculate flat rate
    updateCardFlatRateFromDates(entry, cardElement);
    
    // Check congruency
    verifyAllCardDocumentsCongruency(entry);

    saveDraft();
    updateCardAttachmentPreviews(entry, cardElement);
  });

  // End Date input live change
  const endDateInput = cardElement.querySelector('.end-date-input');
  if (endDateInput) {
    endDateInput.addEventListener('change', (e) => {
      entry.endDate = e.target.value;

      // Recalculate flat rate
      updateCardFlatRateFromDates(entry, cardElement);
      
      // Check congruency
      verifyAllCardDocumentsCongruency(entry);

      saveDraft();
      updateCardAttachmentPreviews(entry, cardElement);
    });
  }

  // Client input live change
  cardElement.querySelector('.client-input').addEventListener('input', (e) => {
    entry.client = e.target.value;
    saveDraft();
  });

  // Type change select
  cardElement.querySelector('.type-select').addEventListener('change', (e) => {
    entry.type = e.target.value;
    if (entry.type === 'trasferta') {
      entry.km = entry.km || '';
      // Calculate inclusive days for new trasferta
      let days = 1;
      if (entry.date && entry.endDate) {
        const start = new Date(entry.date);
        const end = new Date(entry.endDate);
        if (!isNaN(start) && !isNaN(end) && end >= start) {
          days = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
        }
      }
      entry.flatRate = days * (Number(profileState.flatRateRate) || 0);
    } else {
      entry.km = undefined;
      entry.flatRate = 0;
      entry.tolls = 0;
      entry.endDate = undefined;
    }
    saveDraft();
    renderEntries(); // Full render required to swap layout
  });

  // Reimbursement category change select
  const reimbSelect = cardElement.querySelector('.reimbursement-type-select');
  if (reimbSelect) {
    reimbSelect.addEventListener('change', (e) => {
      entry.reimbursementType = e.target.value;
      saveDraft();
      renderEntries(); // Re-render to update ZIP previews and totals
    });
  }

  // Description input change with autocomplete search for trasferta
  cardElement.querySelector('.description-input').addEventListener('input', (e) => {
    const query = e.target.value.trim();
    entry.description = e.target.value;
    saveDraft();
    updateCardAttachmentPreviews(entry, cardElement);

    const dropdown = cardElement.querySelector('.autocomplete-dropdown');
    if (!dropdown) return; // Not a trasferta input

    if (query.length < 3) {
      dropdown.innerHTML = '';
      dropdown.style.display = 'none';
      return;
    }

    clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(async () => {
      try {
        const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
        const res = await fetch(geoUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'RimborsiV2App/2.0 (mayonese-rimborsiv2@example.com)'
          }
        });
        if (!res.ok) return;
        const suggestions = await res.json();

        if (suggestions.length === 0) {
          dropdown.innerHTML = '';
          dropdown.style.display = 'none';
          return;
        }

        dropdown.innerHTML = '';
        suggestions.forEach(item => {
          const div = document.createElement('div');
          div.className = 'autocomplete-item';
          div.innerText = item.display_name;

          div.addEventListener('click', () => {
            e.target.value = item.display_name;
            entry.description = item.display_name;
            dropdown.innerHTML = '';
            dropdown.style.display = 'none';
            saveDraft();
            updateCardAttachmentPreviews(entry, cardElement);
            
            // Instantly trigger calculations with pre-calculated coordinates
            calculateKmForCard(entry, cardElement, parseFloat(item.lat), parseFloat(item.lon));
          });

          dropdown.appendChild(div);
        });
        dropdown.style.display = 'block';
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
    }, 400);
  });

  // Numeric inputs
  const flatRateInput = cardElement.querySelector('.flatrate-input');
  if (flatRateInput) {
    flatRateInput.addEventListener('input', (e) => {
      entry.flatRate = parseFloat(e.target.value) || 0;
      saveDraft();
    });
  }

  const tollsInput = cardElement.querySelector('.tolls-input');
  if (tollsInput) {
    tollsInput.addEventListener('input', (e) => {
      entry.tolls = parseFloat(e.target.value) || 0;
      saveDraft();
    });
  }

  const otherInput = cardElement.querySelector('.other-input');
  if (otherInput) {
    otherInput.addEventListener('input', (e) => {
      entry.other = parseFloat(e.target.value) || 0;
      saveDraft();
    });
  }

  if (entry.type === 'trasferta') {
    cardElement.querySelector('.km-input').addEventListener('input', (e) => {
      entry.km = e.target.value !== '' ? parseFloat(e.target.value) : '';
      saveDraft();
    });

    // Calculate KM trigger
    cardElement.querySelector('.calc-km-btn').addEventListener('click', () => {
      calculateKmForCard(entry, cardElement);
    });
  }

  // File Upload Handlers
  const uploaderZone = cardElement.querySelector('.uploader-zone');
  const filePicker = cardElement.querySelector('.file-picker-input');

  uploaderZone.addEventListener('click', () => filePicker.click());
  filePicker.addEventListener('change', (e) => {
    handleFilesAdded(entry, e.target.files, cardElement);
    e.target.value = '';
  });

  uploaderZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploaderZone.classList.add('dragover');
  });
  uploaderZone.addEventListener('dragleave', () => {
    uploaderZone.classList.remove('dragover');
  });
  uploaderZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploaderZone.classList.remove('dragover');
    if (e.dataTransfer.files) {
      handleFilesAdded(entry, e.dataTransfer.files, cardElement);
    }
  });
}

function handleFilesAdded(entry, fileList, cardElement) {
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const nameLower = file.name.toLowerCase();
    let fileType = 'generico';
    if (nameLower.includes('telepass')) fileType = 'telepass';
    else if (nameLower.includes('autostrada') || nameLower.includes('pedaggio') || nameLower.includes('tratta')) fileType = 'autostrada';
    else if (nameLower.includes('parcheggio') || nameLower.includes('parking') || nameLower.includes('sosta')) fileType = 'parcheggio';

    const attId = 'att-' + Date.now() + '-' + Math.round(Math.random() * 1000) + '-' + i;
    
    const att = {
      id: attId,
      name: file.name,
      type: fileType,
      size: file.size,
      isUploaded: false,
      uploading: true
    };

    entry.attachments.push(att);
    
    // Save File locally in memory for instant previews
    if (!fileObjectsMap[entry.id]) {
      fileObjectsMap[entry.id] = {};
    }
    fileObjectsMap[entry.id][attId] = file;

    // Trigger async upload to server temp folder
    uploadFileImmediately(entry, file, attId, cardElement);
  }
  
  saveDraft();
  renderCardAttachments(entry, cardElement);
}

async function uploadFileImmediately(entry, file, attId, cardElement) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/api/attachments/temp`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error("Errore durante il caricamento.");
    const result = await res.json();
    
    if (result.success) {
      const att = entry.attachments.find(a => a.id === attId);
      if (att) {
        att.fileName = result.fileName;
        att.isUploaded = true;
        att.uploading = false;
      }
      
      saveDraft();
      renderCardAttachments(entry, cardElement);
    }
  } catch (err) {
    console.error(err);
    showToast(`Caricamento fallito per ${file.name}: ${err.message}`, 'danger');
    
    // Remove attachment on failure
    entry.attachments = entry.attachments.filter(a => a.id !== attId);
    if (fileObjectsMap[entry.id]) {
      delete fileObjectsMap[entry.id][attId];
    }
    saveDraft();
    renderCardAttachments(entry, cardElement);
  }
}

function updateCardAttachmentPreviews(entry, cardElement) {
  const container = cardElement.querySelector('.attachments-items-container');
  if (!container) return;
  
  const items = container.querySelectorAll('.attachment-item');
  entry.attachments.forEach((att, idx) => {
    const item = items[idx];
    if (item) {
      item.querySelector('.renamed-preview-box span').innerText = getRenamedFilenamePreview(entry, att);
    }
  });
}

// --- Filename Preview Logic ---
function getRenamedFilenamePreview(entry, att) {
  const x = entriesState.findIndex(e => e.id === entry.id) + 1;
  const clientClean = (entry.client || 'Generico').trim().replace(/[^a-zA-Z0-9]/g, '_');
  
  let dateClean = '00_00_0000';
  if (entry.date) {
    const parts = entry.date.split('-');
    if (parts.length === 3) {
      dateClean = `${parts[2]}_${parts[1]}_${parts[0]}`;
    }
  }
  const prefix = entry.reimbursementType === 'giustificativo' ? 'G' : 'RA';
  const sanitizedOriginal = att.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${x}_${prefix}_${clientClean}_${dateClean}_${sanitizedOriginal}`;
}

// --- Geocoding & Distance Routing ---
async function calculateKmForCard(entry, cardElement, preCalcLat = null, preCalcLon = null) {
  if (!entry.description) {
    showToast('Inserisci una destinazione (tratta) prima di calcolare i KM!', 'warning');
    return;
  }

  const calcZone = cardElement.querySelector('.route-calculator-zone');
  const calcBtn = cardElement.querySelector('.calc-km-btn');
  const kmInput = cardElement.querySelector('.km-input');

  calcBtn.innerHTML = '<i class="fa-solid fa-spinner spinner"></i> Calcolo...';
  calcBtn.disabled = true;
  calcZone.style.display = 'block';

  try {
    let destLat, destLon;

    if (preCalcLat !== null && preCalcLon !== null) {
      destLat = preCalcLat;
      destLon = preCalcLon;
    } else {
      calcZone.innerHTML = '<span style="font-size:11px; color:var(--text-secondary);"><i class="fa-solid fa-spinner spinner"></i> Geocodifica destinazione in corso...</span>';
      // Step A: Geocode via Nominatim
      const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(entry.description)}&format=json&limit=1`;
      const geoRes = await fetch(geoUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RimborsiV2App/2.0 (mayonese-rimborsiv2@example.com)'
        }
      });

      if (!geoRes.ok) throw new Error('Servizio di geocodifica non raggiungibile.');
      const geoData = await geoRes.json();

      if (!geoData || geoData.length === 0) {
        throw new Error('Destinazione non trovata. Inserisci una città o un indirizzo più generico.');
      }

      destLat = parseFloat(geoData[0].lat);
      destLon = parseFloat(geoData[0].lon);
    }

    calcZone.innerHTML = '<span style="font-size:11px; color:var(--text-secondary);"><i class="fa-solid fa-spinner spinner"></i> Calcolo del percorso stradale...</span>';

    // Step B: Calculate driving route via OSRM
    const routeUrl = `https://router.project-osrm.org/route/v1/driving/${ORIGIN_LON},${ORIGIN_LAT};${destLon},${destLat}?alternatives=true&overview=false`;
    const routeRes = await fetch(routeUrl);

    if (!routeRes.ok) throw new Error('Motore di calcolo del percorso non raggiungibile.');
    const routeData = await routeRes.json();

    if (routeData.code === 'Ok' && routeData.routes && routeData.routes.length > 0) {
      const routes = routeData.routes.map((r, idx) => ({
        distance: r.distance, // in meters
        summary: r.legs[0]?.summary || `Percorso alternativo ${idx + 1}`
      }));

      // Average the distances of alternative routes
      const sumDistances = routes.reduce((sum, r) => sum + r.distance, 0);
      const avgDistanceMeters = sumDistances / routes.length;
      
      const singleWayKm = avgDistanceMeters / 1000;
      const roundTripKm = singleWayKm * 2;
      const roundedKm = Math.round(roundTripKm);

      // Update State & input
      entry.km = roundedKm;
      kmInput.value = roundedKm;
      saveDraft();

      // Render calculations details dashboard
      let html = `
        <div class="route-calc-header">
          <span><i class="fa-solid fa-route"></i> Percorsi trovati: <strong>${routes.length}</strong></span>
          <span class="route-badge">OSRM Free Engine</span>
        </div>
        <div class="calc-results-list">
      `;
      
      routes.forEach((r, idx) => {
        const rtKm = Math.round((r.distance / 1000) * 2);
        html += `
          <div class="calc-result-item">
            <span>Opzione ${idx + 1}: ${r.summary || 'Tratta principale'}</span>
            <strong>${rtKm} km A/R</strong>
          </div>
        `;
      });
      
      html += `
          <div class="calc-result-item summary-item">
            <span>Media calcolata e arrotondata (A/R):</span>
            <strong>${roundedKm} km</strong>
          </div>
        </div>
      `;
      calcZone.innerHTML = html;
      showToast(`KM calcolati con successo: ${roundedKm} KM A/R`, 'success');
    } else {
      throw new Error('Nessun percorso stradale trovato per questa destinazione.');
    }
  } catch (error) {
    console.error(error);
    calcZone.innerHTML = `<span style="color:var(--danger); font-size:11px;"><i class="fa-solid fa-circle-exclamation"></i> Errore: ${error.message}</span>`;
    showToast(`Errore nel calcolo KM: ${error.message}`, 'danger');
  } finally {
    calcBtn.innerHTML = '<i class="fa-solid fa-route"></i> Calcola KM';
    calcBtn.disabled = false;
  }
}

// --- Submit Report ---
async function submitReport() {
  if (entriesState.length === 0) {
    showToast('Non hai inserito alcuna spesa. Aggiungi almeno una voce prima di inviare!', 'warning');
    return;
  }

  // Profile validations
  if (!profileState.surname || !profileState.name || !profileState.period) {
    showToast('Compila i campi obbligatori del profilo (Cognome, Nome, Periodo di Riferimento) prima di procedere.', 'warning');
    return;
  }

  // Entries validations
  let invalidEntries = [];
  entriesState.forEach((entry, idx) => {
    if (!entry.date || !entry.client || !entry.description) {
      invalidEntries.push(idx + 1);
    }
  });

  if (invalidEntries.length > 0) {
    showToast(`Compila tutti i campi obbligatori (Data, Cliente, Descrizione/Tratta) nelle righe: ${invalidEntries.join(', ')}`, 'warning');
    return;
  }

  // Warning if rows > 18
  if (entriesState.length > 18) {
    const confirmOverlimit = confirm(
      `Attenzione! Il modulo Excel ministeriale ha un limite di 18 righe.\n` +
      `Hai inserito ${entriesState.length} righe. Quelle oltre la 18esima verranno ignorate nel foglio Excel.\n` +
      `Desideri procedere comunque? (Consigliato: dividere in più note spese separate)`
    );
    if (!confirmOverlimit) return;
  }

  const submitBtn = document.getElementById('submit-report-btn');
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner spinner"></i> Invio in corso...';
  submitBtn.disabled = true;

  try {
    // Sort entriesState copy chronologically by date
    const sortedEntries = [...entriesState].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date('9999-12-31');
      const dateB = b.date ? new Date(b.date) : new Date('9999-12-31');
      return dateA - dateB;
    });

    const metadata = {
      profile: { ...profileState },
      items: sortedEntries.map((entry) => {
        const itemCopy = { ...entry };
        
        // Ensure all attachments have their server fileName populated
        itemCopy.attachments = (entry.attachments || []).map((att) => {
          if (!att.isUploaded || !att.fileName) {
            throw new Error(`L'allegato "${att.name}" non è stato ancora caricato sul server. Attendi o ricaricalo.`);
          }
          return {
            id: att.id,
            name: att.name,
            originalName: att.name,
            fileName: att.fileName,
            type: att.type,
            size: att.size
          };
        });

        return itemCopy;
      })
    };

    const response = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });

    if (!response.ok) {
      const errRes = await response.json();
      throw new Error(errRes.error || 'Errore di connessione al server.');
    }

    const resData = await response.json();
    showToast('Nota spese inviata con successo all\'amministrazione!', 'success');
    
    // Clear draft and files map
    localStorage.removeItem('rimborsi_v2_draft');
    entriesState = [];
    fileObjectsMap = {};
    
    setTimeout(() => {
      // Redirect to home
      location.href = 'index.html';
    }, 2000);
  } catch (err) {
    console.error(err);
    showToast(`Invio fallito: ${err.message}`, 'danger');
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
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

// --- Tab Navigation & History ---
function setupTabs() {
  const tabFormBtn = document.getElementById('tab-form-btn');
  const tabHistoryBtn = document.getElementById('tab-history-btn');
  const formView = document.getElementById('form-view-container');
  const historyView = document.getElementById('history-view-container');

  if (!tabFormBtn || !tabHistoryBtn) return;

  tabFormBtn.addEventListener('click', () => {
    tabFormBtn.classList.add('active');
    tabHistoryBtn.classList.remove('active');
    formView.style.display = 'block';
    historyView.style.display = 'none';
  });

  tabHistoryBtn.addEventListener('click', () => {
    tabHistoryBtn.classList.add('active');
    tabFormBtn.classList.remove('active');
    formView.style.display = 'none';
    historyView.style.display = 'block';
    
    // Fetch and render history
    fetchAndRenderUserHistory();
  });

  // Modal close listeners
  const modal = document.getElementById('detail-modal');
  const modalClose = document.getElementById('modal-close');
  const modalCloseBtn = document.getElementById('modal-close-btn');

  const closeModal = () => modal.classList.remove('active');
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);

  // Close suggestions dropdown when clicking outside
  document.addEventListener('click', (evt) => {
    if (!evt.target.closest('.autocomplete-wrapper')) {
      const dropdowns = document.querySelectorAll('.autocomplete-dropdown');
      dropdowns.forEach(d => {
        d.innerHTML = '';
        d.style.display = 'none';
      });
    }
  });
}

async function fetchAndRenderUserHistory() {
  const historyList = document.getElementById('history-list');
  const emptyState = document.getElementById('history-empty-state');
  const emptyText = document.getElementById('history-empty-text');

  historyList.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-secondary);"><i class="fa-solid fa-spinner spinner"></i> Caricamento storico in corso...</div>';
  emptyState.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/api/reports`);
    if (!res.ok) throw new Error("Impossibile recuperare i dati dal server.");
    
    const reports = await res.json();
    
    // Filter reports by current profile surname (case-insensitive)
    const userSurname = (profileState.surname || '').trim().toLowerCase();
    
    const myReports = reports.filter(r => {
      if (!userSurname) return false;
      return r.employee.toLowerCase().includes(userSurname);
    });

    // Sort: newest first
    myReports.sort((a, b) => new Date(b.dateSubmitted) - new Date(a.dateSubmitted));

    if (myReports.length === 0) {
      historyList.innerHTML = '';
      emptyState.style.display = 'block';
      emptyText.innerText = userSurname 
        ? `Nessuna nota spese inviata trovata nel database per il cognome "${profileState.surname}".`
        : "Inserisci il tuo cognome nel profilo a sinistra per visualizzare lo storico dei tuoi invii.";
      return;
    }

    historyList.innerHTML = '';
    myReports.forEach(report => {
      const card = document.createElement('div');
      card.className = 'glass-panel';
      card.style.padding = '16px';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';
      card.style.gap = '16px';
      card.style.border = '1px solid rgba(255, 255, 255, 0.05)';
      card.style.background = 'rgba(255, 255, 255, 0.01)';
      
      const dateFormatted = new Date(report.dateSubmitted).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const timeFormatted = new Date(report.dateSubmitted).toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit'
      });

      card.innerHTML = `
        <div style="flex-grow:1; display:flex; flex-direction:column; gap:4px; overflow:hidden;">
          <h4 style="font-family:var(--font-title); font-size:15px; color:#ffffff; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
            Nota del ${dateFormatted} <span style="font-size:11px; font-weight:normal; color:var(--text-secondary); margin-left:6px;">alle ${timeFormatted}</span>
          </h4>
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:11px; color:var(--text-secondary);">
            <span>Periodo: <strong style="color:#ffffff;">${report.period}</strong></span>
            <span style="color:rgba(255,255,255,0.15);">|</span>
            <span>Voci: <strong>${report.entriesCount}</strong></span>
            <span style="color:rgba(255,255,255,0.15);">|</span>
            <span style="color:var(--success); font-weight:600;">${parseFloat(report.totalSpent).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</span>
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-shrink:0;">
          <button class="btn btn-outline btn-sm preview-excel-btn" style="padding: 5px 8px; border-color: var(--success); color: var(--success);" title="Anteprima Excel"><i class="fa-solid fa-file-excel"></i></button>
          <button class="btn btn-outline btn-sm view-detail-btn" style="padding: 5px 8px;" title="Vedi Dettaglio"><i class="fa-solid fa-eye"></i></button>
          <a href="/api/reports/${report.id}/excel" class="btn btn-primary btn-sm" style="padding: 5px 8px;" title="Scarica Excel"><i class="fa-solid fa-file-excel"></i></a>
          <a href="/api/reports/${report.id}/zip" class="btn btn-secondary btn-sm" style="padding: 5px 8px; ${report.attachmentsCount === 0 ? 'pointer-events: none; opacity: 0.5;' : ''}" title="Scarica ZIP"><i class="fa-solid fa-file-zipper"></i></a>
        </div>
      `;

      card.querySelector('.view-detail-btn').addEventListener('click', () => {
        showUserReportDetail(report.id);
      });

      card.querySelector('.preview-excel-btn').addEventListener('click', async () => {
        try {
          const res = await fetch(`${API_BASE}/api/reports/${report.id}`);
          if (!res.ok) throw new Error("Dati del report non trovati.");
          const reportDetails = await res.json();
          showExcelPreview(reportDetails);
        } catch (err) {
          showToast(`Errore: ${err.message}`, 'danger');
        }
      });

      historyList.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    historyList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Errore: ${err.message}</div>`;
  }
}

async function showUserReportDetail(reportId) {
  const modal = document.getElementById('detail-modal');
  const modalBody = document.getElementById('modal-body-content');
  const modalTitle = document.getElementById('modal-title');

  modalTitle.innerText = "Caricamento in corso...";
  modalBody.innerHTML = `
    <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
      <i class="fa-solid fa-circle-notch spinner" style="font-size: 24px; color: var(--primary); display:block; margin: 0 auto 10px;"></i>
      Recupero dettagli dal server...
    </div>
  `;
  modal.classList.add('active');

  try {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}`);
    if (!res.ok) throw new Error("Dati del report non trovati.");
    
    const report = await res.json();
    
    modalTitle.innerText = `Dettaglio Nota Spese - ${report.profile.name} ${report.profile.surname}`;

    // Calculate totals
    const kmRefundSum = report.items.reduce((sum, item) => {
      if (item.type === 'trasferta' && item.km) {
        return sum + (item.km * (report.profile.costKm || 0));
      }
      return sum;
    }, 0);

    const flatRateSum = report.items.reduce((sum, item) => sum + (Number(item.flatRate) || 0), 0);
    const tollsSum = report.items.reduce((sum, item) => sum + (Number(item.tolls) || 0), 0);
    const otherSum = report.items.reduce((sum, item) => sum + (Number(item.other) || 0), 0);
    const grandTotal = kmRefundSum + flatRateSum + tollsSum + otherSum;

    let html = `
      <div class="info-list" style="margin-bottom:16px;">
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px;">
          <span style="color:var(--text-secondary);">Periodo</span><strong>${report.profile.period}</strong>
        </div>
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px;">
          <span style="color:var(--text-secondary);">Società</span><strong>${report.profile.company}</strong>
        </div>
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px;">
          <span style="color:var(--text-secondary);">Veicolo</span><strong>${report.profile.carModel} (${report.profile.plate})</strong>
        </div>
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px;">
          <span style="color:var(--text-secondary);">Tariffa KM</span><strong>${report.profile.costKm} €/km</strong>
        </div>
      </div>

      <h4 style="font-family:var(--font-title); font-size:13px; font-weight:600; color:#ffffff; margin-bottom:8px; text-transform:uppercase;">Elenco Spese</h4>
      <div class="inner-table-container" style="max-height:200px; margin-bottom:16px; border:1px solid var(--border-color); border-radius:8px; overflow-y:auto;">
        <table class="inner-table" style="width:100%; border-collapse:collapse; font-size:11px;">
          <thead>
            <tr style="background:rgba(0,0,0,0.3); text-align:left; color: var(--text-secondary);">
              <th style="padding:6px 8px; font-size: 10px; font-weight:600; text-transform:uppercase; width: 40px; text-align:center;">Riga</th>
              <th style="padding:6px 8px; font-size: 10px; font-weight:600; text-transform:uppercase;">Data</th>
              <th style="padding:6px 8px; font-size: 10px; font-weight:600; text-transform:uppercase;">Cliente</th>
              <th style="padding:6px 8px; font-size: 10px; font-weight:600; text-transform:uppercase;">Descrizione / Tratta</th>
              <th style="padding:6px 8px; font-size: 10px; font-weight:600; text-transform:uppercase;">KM</th>
              <th style="padding:6px 8px; font-size: 10px; font-weight:600; text-transform:uppercase; text-align:right;">Totale</th>
            </tr>
          </thead>
          <tbody>
    `;

    report.items.forEach((item, i) => {
      let dateStr = item.date || '';
      if (dateStr) {
        const parts = dateStr.split('-');
        if (parts.length === 3) dateStr = `${parts[2]}/${parts[1]}`;
      }
      
      const rowKmRefund = item.type === 'trasferta' && item.km ? (item.km * (report.profile.costKm || 0)) : 0;
      const rowTotal = (Number(item.flatRate) || 0) + (Number(item.tolls) || 0) + (Number(item.other) || 0) + rowKmRefund;

      html += `
        <tr style="border-bottom:1px solid var(--border-color);">
          <td style="padding:6px 8px; text-align:center; font-weight:bold; color:var(--success);">#${i + 1}</td>
          <td style="padding:6px 8px;">${dateStr}</td>
          <td style="padding:6px 8px; font-weight:500;">${item.client || '-'}</td>
          <td style="padding:6px 8px;" title="${item.description}">${item.description || '-'}</td>
          <td style="padding:6px 8px;">${item.type === 'trasferta' && item.km ? item.km : '-'}</td>
          <td style="padding:6px 8px; text-align:right; font-weight:600; color:var(--success);">${rowTotal.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>

      <!-- Financial Breakdown -->
      <div class="info-list" style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border:1px solid var(--border-color); margin-bottom:16px;">
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px; color:var(--text-secondary);">
          <span>Rimb. Chilometrico</span><strong style="color:#fff;">${kmRefundSum.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong>
        </div>
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px; color:var(--text-secondary);">
          <span>Pedaggi / Autostrada</span><strong style="color:#fff;">${tollsSum.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong>
        </div>
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px; color:var(--text-secondary);">
          <span>Rimborsi Forfettari</span><strong style="color:#fff;">${flatRateSum.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong>
        </div>
        <div class="info-item" style="display:flex; justify-content:space-between; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 6px; font-size: 12px; color:var(--text-secondary);">
          <span>Spese Varie / Altro</span><strong style="color:#fff;">${otherSum.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong>
        </div>
        <div class="info-item" style="display:flex; justify-content:space-between; border-top:1px dashed rgba(255,255,255,0.2); padding-top:6px; margin-top:4px; font-size:12px;">
          <span style="font-weight:600; color:#fff;">TOTALE RENDICONTO</span>
          <strong style="color:var(--success); font-size:14px;">${grandTotal.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</strong>
        </div>
      </div>
    `;

    // Attachments
    const allAttachments = report.items.reduce((list, item) => {
      if (item.attachments) {
        item.attachments.forEach(att => list.push(att));
      }
      return list;
    }, []);

    html += `<h4 style="font-family:var(--font-title); font-size:13px; font-weight:600; color:#ffffff; margin-bottom:8px; text-transform:uppercase;">Documenti Allegati (${allAttachments.length})</h4>`;
    
    if (allAttachments.length === 0) {
      html += `<p style="font-size:11px; color:var(--text-muted); font-style:italic;">Nessun documento allegato.</p>`;
    } else {
      html += `<div style="display:flex; flex-direction:column; gap:6px;">`;
      allAttachments.forEach(att => {
        const sizeFormatted = att.size ? (att.size / 1024).toFixed(1) + ' KB' : '';
        html += `
          <div style="background:rgba(255,255,255,0.05); border:1px solid var(--border-color); border-radius:6px; padding:6px 10px; font-size:11px; display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fa-solid fa-file-invoice" style="color:var(--primary); margin-right:6px;"></i>${att.originalName} (${sizeFormatted})</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <a href="${API_BASE}/uploads/${report.id}/${att.fileName}" target="_blank" class="btn btn-outline btn-sm" style="padding: 2px 6px; font-size:9px; display:inline-flex; align-items:center; gap:4px;" title="Apri allegato">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Apri
              </a>
              <span style="font-size:8px; font-weight:700; padding:1px 4px; border-radius:3px; text-transform:uppercase; background:rgba(99,102,241,0.2); color:#818cf8;">${att.type}</span>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    modalBody.innerHTML = html;
  } catch (err) {
    console.error(err);
    modalBody.innerHTML = `<div style="color:var(--danger); text-align:center; padding:20px;">Errore: ${err.message}</div>`;
  }
}

// --- Lightbox Modal Previews ---
function setupLightbox() {
  const modal = document.getElementById('lightbox-modal');
  const closeBtn = document.getElementById('lightbox-close');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    
    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }
}

function showLightbox(url, title) {
  const modal = document.getElementById('lightbox-modal');
  const content = document.getElementById('lightbox-content');
  const titleEl = document.getElementById('lightbox-title');
  if (!modal || !content) return;
  
  titleEl.innerText = title || "Anteprima Allegato";
  content.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">`;
  modal.classList.add('active');
}

function showExcelPreview(report) {
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

    const displayDesc = isGiustificativo ? `[G] ${entry.description || ''}` : (entry.description || '');

    html += `
      <div style="display: flex; border-bottom: 1px solid #d3d3d3; min-height: 28px; align-items: center; background: ${i % 2 === 0 ? '#ffffff' : '#fcfcfc'};">
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

