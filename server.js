const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const driveHelper = require('./driveHelper');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

// Google Drive on-demand attachment restore middleware
app.get('/uploads/:reportId/:fileName', async (req, res, next) => {
  const { reportId, fileName } = req.params;
  if (reportId === 'temp') return next(); // Skip temp files
  
  const localPath = path.join(UPLOADS_DIR, reportId, fileName);
  if (fs.existsSync(localPath)) {
    return next();
  }
  
  // Try to download it from Google Drive
  const restored = await driveHelper.downloadFileFromDriveIfMissing(reportId, fileName);
  if (restored) {
    return next();
  }
  
  next();
});

app.use('/uploads', express.static(UPLOADS_DIR));

const DB_PATH = path.join(DATA_DIR, 'db.json');

// Initialize database if it doesn't exist
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2), 'utf8');
}

// Multer storage configuration for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // We will save to a temporary folder initially, then move to report-specific folders on submit
    const tempDir = path.join(UPLOADS_DIR, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Helper to read database
function readDb() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(data);

    // Auto-clean expired trash (older than 60 days)
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    let expiredFound = false;

    const active = db.filter(report => {
      if (report.deleted && report.deletedAt) {
        const deletedDate = new Date(report.deletedAt);
        if (deletedDate < cutoff) {
          expiredFound = true;
          // Purge files permanently
          const reportUploadDir = path.join(UPLOADS_DIR, report.id);
          if (fs.existsSync(reportUploadDir)) {
            fs.rmSync(reportUploadDir, { recursive: true, force: true });
          }
          return false;
        }
      }
      return true;
    });

    if (expiredFound) {
      fs.writeFileSync(DB_PATH, JSON.stringify(active, null, 2), 'utf8');
      return active;
    }
    return db;
  } catch (error) {
    console.error('Error reading database:', error);
    return [];
  }
}

// Helper to write database
function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    driveHelper.uploadDatabase(); // sync database on Drive
  } catch (error) {
    console.error('Error writing database:', error);
  }
}

// Helper: Format Date for Italian displays (DD/MM/YYYY)
function formatDateItalian(dateString) {
  if (!dateString) return '';
  const parts = dateString.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateString;
}

// Helper: Format Date for attachment filenames (DD-MM)
function formatDateShort(dateString) {
  if (!dateString) return '00-00';
  const dateObj = new Date(dateString);
  if (isNaN(dateObj.getTime())) {
    const parts = dateString.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}`;
    }
    return '00-00';
  }
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}`;
}

// Helper: Format Date range for attachment filenames
function formatDateShortRange(startDate, endDate) {
  if (!startDate) return '00-00';
  const startFmt = formatDateShort(startDate);
  if (endDate && endDate !== startDate) {
    const endFmt = formatDateShort(endDate);
    return `${startFmt}_${endFmt}`;
  }
  return startFmt;
}

// --- API Endpoints ---

// 1. GET /api/reports - Get all reports
app.get('/api/reports', (req, res) => {
  const db = readDb();
  const activeReports = db.filter(r => !r.deleted);
  // Return summarized information for the list view
  const summary = activeReports.map(report => {
    // Calculate total amount spent
    const totalKmRefund = report.items.reduce((sum, item) => {
      if (item.type === 'trasferta' && item.km) {
        return sum + (item.km * (report.profile.costKm || 0));
      }
      return sum;
    }, 0);
    
    const totalOther = report.items.reduce((sum, item) => {
      const flat = Number(item.flatRate) || 0;
      const tolls = Number(item.tolls) || 0;
      const other = Number(item.other) || 0;
      return sum + flat + tolls + other;
    }, 0);

    const totalSpent = totalKmRefund + totalOther;

    const dates = report.items.map(item => item.date).filter(Boolean);
    const endDates = report.items.map(item => item.endDate || item.date).filter(Boolean);
    const minDate = dates.length > 0 ? dates.reduce((min, d) => d < min ? d : min) : '';
    const maxDate = endDates.length > 0 ? endDates.reduce((max, d) => d > max ? d : max) : '';

    return {
      id: report.id,
      dateSubmitted: report.dateSubmitted,
      employee: `${report.profile.name} ${report.profile.surname}`,
      period: report.profile.period,
      company: report.profile.company,
      entriesCount: report.items.length,
      attachmentsCount: report.items.reduce((sum, item) => sum + (item.attachments ? item.attachments.length : 0), 0),
      totalSpent: totalSpent.toFixed(2),
      minDate,
      maxDate,
      profile: report.profile,
      items: report.items
    };
  });

  res.json(summary);
});

// 5.5 GET /api/reports/export-period - Export consolidated Excel for a given period
app.get('/api/reports/export-period', async (req, res) => {
  try {
    const { start, end, employee, onlyViola } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Parametri start e end obbligatori (formato YYYY-MM)' });
    }

    const startLimit = `${start}-01`;
    const parts = end.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const lastDay = new Date(year, month, 0).getDate();
    const endLimit = `${end}-${String(lastDay).padStart(2, '0')}`;

    const db = readDb();
    
    // Collect all items from all reports falling in this period
    let consolidatedItems = [];
    db.forEach(report => {
      if (report.deleted) return;

      const fullName = `${report.profile.name} ${report.profile.surname}`;
      if (employee && fullName.toLowerCase().trim() !== employee.toLowerCase().trim()) return;

      report.items.forEach(item => {
        const itemDate = item.date || '0000-01-01';
        if (itemDate >= startLimit && itemDate <= endLimit) {
          if (onlyViola === 'true' && item.color !== 'viola') return;
          consolidatedItems.push({
            ...item,
            employeeName: fullName,
            costKm: report.profile.costKm || 0,
            flatRateRate: report.profile.flatRateRate || 0
          });
        }
      });
    });

    // Sort chronologically
    consolidatedItems.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date('9999-12-31');
      const dateB = b.date ? new Date(b.date) : new Date('9999-12-31');
      return dateA - dateB;
    });

    if (consolidatedItems.length === 0) {
      return res.status(404).json({ error: 'Nessuna voce di spesa trovata nel periodo selezionato.' });
    }

    const templatePath = path.join(TEMPLATES_DIR, 'template.xlsx');
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: 'Excel template file not found on server' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.getWorksheet('Nota spese') || workbook.worksheets[0];
    // Format start/end for display (DD/MM/YYYY)
    const startFmt = `01/${start.split('-')[1]}/${start.split('-')[0]}`;
    const endFmt = `${lastDay}/${end.split('-')[1]}/${end.split('-')[0]}`;

    // Write profile headers
    const targetReport = db.find(r => !r.deleted && `${r.profile.name} ${r.profile.surname}`.toLowerCase().trim() === (employee || '').toLowerCase().trim());
    if (targetReport) {
      const violaSfx = onlyViola === 'true' ? ' (VOCI VIOLA)' : '';
      sheet.getCell('A1').value = `${targetReport.profile.surname.toUpperCase()} ${targetReport.profile.name.toUpperCase()}${violaSfx}`;
      sheet.getCell('C1').value = 'Mayonese s.r.l.';
      sheet.getCell('C2').value = targetReport.profile.role || '';
      sheet.getCell('B3').value = `${startFmt} - ${endFmt}`;
      sheet.getCell('D3').value = targetReport.profile.vehicle || '-';
      sheet.getCell('D4').value = targetReport.profile.plate || '-';
      sheet.getCell('D5').value = targetReport.profile.engine || '-';
      sheet.getCell('D6').value = targetReport.profile.fuel || '-';
      sheet.getCell('H3').value = Number(targetReport.profile.costKm) || 0.45;
      sheet.getCell('H4').value = Number(targetReport.profile.flatRateRate) || 46.48;
    } else {
      const violaSfx = onlyViola === 'true' ? ' (SOLO VIOLA)' : '';
      sheet.getCell('A1').value = `CONSOLIDATO AMMINISTRAZIONE${violaSfx}`;
      sheet.getCell('C1').value = 'Mayonese s.r.l.';
      sheet.getCell('C2').value = '';
      sheet.getCell('B3').value = `${startFmt} - ${endFmt}`;
      sheet.getCell('D3').value = 'Consolidato';
      sheet.getCell('D4').value = '-';
      sheet.getCell('D5').value = '-';
      sheet.getCell('D6').value = '-';
      
      // Average or default CostKM/Flatrate for formulas
      const avgCostKm = consolidatedItems.reduce((sum, item) => sum + item.costKm, 0) / consolidatedItems.length;
      const avgFlatRate = consolidatedItems.reduce((sum, item) => sum + item.flatRateRate, 0) / consolidatedItems.length;
      sheet.getCell('H3').value = avgCostKm || 0.45;
      sheet.getCell('H4').value = avgFlatRate || 46.48;
    }

    // Fill table rows (maximum 18 items)
    for (let i = 0; i < 18; i++) {
      const rowNum = 9 + i;
      const row = sheet.getRow(rowNum);
      
      if (i < consolidatedItems.length) {
        const item = consolidatedItems[i];
        
        row.getCell(1).value = i + 1; // Num
        
        let dateVal = '';
        if (item.date) {
          const startFmt = formatDateItalian(item.date);
          if (item.endDate && item.endDate !== item.date) {
            const endFmt = formatDateItalian(item.endDate);
            dateVal = `${startFmt} - ${endFmt}`;
          } else {
            dateVal = startFmt;
          }
        }
        row.getCell(2).value = dateVal; // Data
        // Prepend employee name only if generic (no specific employee selected)
        row.getCell(3).value = employee ? (item.client || '') : `[${item.employeeName}] ${item.client || ''}`; // Cliente/Progetto
        const isGiustificativo = item.reimbursementType === 'giustificativo';
        const descPrefix = isGiustificativo ? '[G] ' : '';
        row.getCell(4).value = descPrefix + (item.description || ''); // Descrizione / Tratta
        row.getCell(5).value = Number(item.flatRate) || 0; // Rimb. Forfettario
        row.getCell(6).value = Number(item.tolls) || 0; // Pedaggi
        row.getCell(7).value = item.type === 'trasferta' ? (Number(item.km) || 0) : null; // KM Percorsi
        row.getCell(9).value = Number(item.other) || 0; // Altro
        
        // Formulas
        row.getCell(8).value = { formula: `G${rowNum}*CostoChilometrico` }; // Rimb.Chilometrico
        row.getCell(10).value = { formula: `E${rowNum}+F${rowNum}+H${rowNum}+I${rowNum}` }; // Totale

        if (highlightViola === 'true' && item.color === 'viola') {
          for (let col = 1; col <= 10; col++) {
            row.getCell(col).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF0E6FF' } // light soft purple
            };
          }
        } else {
          // Reset fill in case template had styles
          for (let col = 1; col <= 10; col++) {
            row.getCell(col).fill = { type: 'none' };
          }
        }
      } else {
        // Clear cells of empty rows and remove fill
        for (let col = 1; col <= 10; col++) {
          row.getCell(col).value = null;
          row.getCell(col).fill = { type: 'none' };
        }
      }
    }

    // Explicitly write totals formulas
    sheet.getCell('E27').value = { formula: 'SUM(E9:E26)' };
    sheet.getCell('F27').value = { formula: 'SUM(F9:F26)' };
    sheet.getCell('H27').value = { formula: 'SUM(H9:H26)' };
    sheet.getCell('I27').value = { formula: 'SUM(I9:I26)' };
    sheet.getCell('J27').value = { formula: 'SUM(J9:J26)' };

    // Dashboard totals (excluding justifications prefixed with [G] in description)
    sheet.getCell('K2').value = { formula: 'K4+L4+K6+L6' };
    sheet.getCell('K4').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", H9:H26)' };
    sheet.getCell('L4').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", F9:F26)' };
    sheet.getCell('K6').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", I9:I26)' };
    sheet.getCell('L6').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", E9:E26)' };

    const filename = `RIMB_CONSOLIDATO_${start.replace('-','_')}_${end.replace('-','_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating consolidated Excel:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 2. GET /api/reports/:id - Get detailed report
app.get('/api/reports/:id', (req, res) => {
  const db = readDb();
  const report = db.find(r => r.id === req.params.id && !r.deleted);
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }
  // Sort items chronologically by date
  if (report.items) {
    report.items.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date('9999-12-31');
      const dateB = b.date ? new Date(b.date) : new Date('9999-12-31');
      return dateA - dateB;
    });
  }
  res.json(report);
});

// 3. POST /api/reports - Submit a new report (JSON payload)
app.post('/api/reports', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.profile || !payload.items) {
      return res.status(400).json({ error: 'Missing report metadata' });
    }

    const reportId = 'rep-' + Date.now();
    
    // Create directory for this report's uploads
    const reportUploadDir = path.join(UPLOADS_DIR, reportId);
    if (!fs.existsSync(reportUploadDir)) {
      fs.mkdirSync(reportUploadDir, { recursive: true });
    }

    // Process items and move temporary files to report folder
    const processedItems = payload.items.map(item => {
      const attachments = (item.attachments || []).map(att => {
        if (att.fileName) {
          const tempPath = path.join(UPLOADS_DIR, 'temp', att.fileName);
          const destPath = path.join(reportUploadDir, att.fileName);
          
          // Move from temp folder to report folder if it exists in temp
          if (fs.existsSync(tempPath)) {
            fs.renameSync(tempPath, destPath);
          } else {
            // Check if it's already in destination
            if (!fs.existsSync(destPath)) {
              console.warn(`File ${att.fileName} not found in temp or destination.`);
              return null; // File missing
            }
          }

          return {
            id: att.id,
            originalName: att.name || att.originalName,
            fileName: att.fileName,
            type: att.type,
            size: att.size
          };
        }
        return null;
      }).filter(Boolean);

      return {
        ...item,
        attachments
      };
    });

    const newReport = {
      id: reportId,
      dateSubmitted: new Date().toISOString(),
      profile: payload.profile,
      items: processedItems
    };

    const db = readDb();
    db.push(newReport);
    writeDb(db);

    // Upload attachments to Google Drive in the background
    processedItems.forEach(item => {
      (item.attachments || []).forEach(att => {
        if (att.fileName) {
          driveHelper.uploadAttachment(reportId, att.fileName);
        }
      });
    });

    res.status(201).json({ success: true, reportId });
  } catch (error) {
    console.error('Error submitting report:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 3.5 POST /api/attachments/temp - Upload file to temp folder for drafts
app.post('/api/attachments/temp', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }
    
    // Sync temporary file to Google Drive in the background
    driveHelper.uploadTempAttachment(req.file.filename);

    res.json({
      success: true,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    console.error('Error in temp upload:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 4. DELETE /api/reports/:id - Move a report to trash
app.delete('/api/reports/:id', (req, res) => {
  const db = readDb();
  const report = db.find(r => r.id === req.params.id);
  
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  // Mark as deleted with timestamp (expires in 60 days)
  report.deleted = true;
  report.deletedAt = new Date().toISOString();
  
  writeDb(db);
  res.json({ success: true, message: 'Report spostato nel cestino' });
});

// 4.2 GET /api/trash - Retrieve all deleted reports in trash
app.get('/api/trash', (req, res) => {
  const db = readDb();
  const trash = db.filter(r => r.deleted).map(report => {
    const deletedTime = new Date(report.deletedAt).getTime();
    const nowTime = new Date().getTime();
    const diffDays = Math.max(0, 60 - Math.floor((nowTime - deletedTime) / (1000 * 60 * 60 * 24)));

    return {
      id: report.id,
      employee: `${report.profile.name} ${report.profile.surname}`,
      period: report.profile.period,
      deletedAt: report.deletedAt,
      daysRemaining: diffDays
    };
  });
  res.json(trash);
});

// 4.5 POST /api/trash/:id/restore - Restore a deleted report from trash
app.post('/api/trash/:id/restore', (req, res) => {
  const db = readDb();
  const report = db.find(r => r.id === req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  report.deleted = false;
  delete report.deletedAt;

  writeDb(db);
  res.json({ success: true, message: 'Report ripristinato con successo' });
});

// 5. GET /api/reports/:id/excel - Generate Excel
app.get('/api/reports/:id/excel', async (req, res) => {
  try {
    const { highlightViola } = req.query;
    const db = readDb();
    const report = db.find(r => r.id === req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Sort items chronologically by date
    if (report.items) {
      report.items.sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date('9999-12-31');
        const dateB = b.date ? new Date(b.date) : new Date('9999-12-31');
        return dateA - dateB;
      });
    }

    const templatePath = path.join(TEMPLATES_DIR, 'template.xlsx');
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: 'Excel template file not found on server' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.getWorksheet('Nota spese') || workbook.worksheets[0];

    // Write profile data
    sheet.getCell('A1').value = `${report.profile.name || ''} ${report.profile.surname || ''}`.trim();
    sheet.getCell('C1').value = 'Mayonese s.r.l.';
    sheet.getCell('C2').value = report.profile.role || '';

    // Automatically calculate start/end date range from items
    let calculatedPeriod = '';
    if (report.items && report.items.length > 0) {
      const dates = report.items.map(item => item.date).filter(Boolean);
      const endDates = report.items.map(item => item.endDate || item.date).filter(Boolean);
      if (dates.length > 0) {
        const minDate = dates.reduce((min, d) => d < min ? d : min);
        const maxDate = endDates.reduce((max, d) => d > max ? d : max);
        const minParts = minDate.split('-');
        const maxParts = maxDate.split('-');
        if (minParts.length === 3 && maxParts.length === 3) {
          calculatedPeriod = `${minParts[2]}/${minParts[1]}/${minParts[0]} - ${maxParts[2]}/${maxParts[1]}/${maxParts[0]}`;
        }
      }
    }
    sheet.getCell('B3').value = calculatedPeriod;
    sheet.getCell('D3').value = report.profile.carModel || '';
    sheet.getCell('D4').value = report.profile.plate || '';
    sheet.getCell('D5').value = report.profile.engine || '';
    sheet.getCell('D6').value = report.profile.fuel || '';
    sheet.getCell('H3').value = Number(report.profile.costKm) || 0;
    sheet.getCell('H4').value = Number(report.profile.flatRateRate) || 0;

    // Fill table rows (maximum 18 items, rows 9 to 26)
    for (let i = 0; i < 18; i++) {
      const rowNum = 9 + i;
      const row = sheet.getRow(rowNum);
      
      if (i < report.items.length) {
        const item = report.items[i];
        
        row.getCell(1).value = i + 1; // Num
        let dateVal = '';
        if (item.date) {
          const startFmt = formatDateItalian(item.date);
          if (item.endDate && item.endDate !== item.date) {
            const endFmt = formatDateItalian(item.endDate);
            dateVal = `${startFmt} - ${endFmt}`;
          } else {
            dateVal = startFmt;
          }
        }
        row.getCell(2).value = dateVal; // Data
        row.getCell(3).value = item.client || ''; // Cliente/Progetto
        const isGiustificativo = item.reimbursementType === 'giustificativo';
        const descPrefix = isGiustificativo ? '[G] ' : '';
        row.getCell(4).value = descPrefix + (item.description || ''); // Descrizione / Tratta
        row.getCell(5).value = Number(item.flatRate) || 0; // Rimb. Forfettario
        row.getCell(6).value = Number(item.tolls) || 0; // Pedaggi
        row.getCell(7).value = item.type === 'trasferta' ? (Number(item.km) || 0) : null; // KM Percorsi
        row.getCell(9).value = Number(item.other) || 0; // Altro
        
        // Formulas
        row.getCell(8).value = { formula: `G${rowNum}*CostoChilometrico` }; // Rimb.Chilometrico
        row.getCell(10).value = { formula: `E${rowNum}+F${rowNum}+H${rowNum}+I${rowNum}` }; // Totale

        if (highlightViola === 'true' && item.color === 'viola') {
          for (let col = 1; col <= 10; col++) {
            row.getCell(col).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF0E6FF' } // light soft purple
            };
          }
        } else {
          for (let col = 1; col <= 10; col++) {
            row.getCell(col).fill = { type: 'none' };
          }
        }
      } else {
        // Clear cells of empty rows and remove fill
        for (let col = 1; col <= 10; col++) {
          row.getCell(col).value = null;
          row.getCell(col).fill = { type: 'none' };
        }
      }
    }

    // Explicitly write totals formulas to ensure they remain functional
    sheet.getCell('E27').value = { formula: 'SUM(E9:E26)' };
    sheet.getCell('F27').value = { formula: 'SUM(F9:F26)' };
    sheet.getCell('H27').value = { formula: 'SUM(H9:H26)' };
    sheet.getCell('I27').value = { formula: 'SUM(I9:I26)' };
    sheet.getCell('J27').value = { formula: 'SUM(J9:J26)' };

    // Dashboard totals (excluding justifications prefixed with [G] in description)
    sheet.getCell('K2').value = { formula: 'K4+L4+K6+L6' };
    sheet.getCell('K4').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", H9:H26)' };
    sheet.getCell('L4').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", F9:F26)' };
    sheet.getCell('K6').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", I9:I26)' };
    sheet.getCell('L6').value = { formula: 'SUMIF(D9:D26, "<>*[G]*", E9:E26)' };

    // Set response headers and send the workbook stream
    const cleanSurname = (report.profile.surname || 'martinelli').toLowerCase().replace(/\s+/g, '_');
    const cleanPeriod = (report.profile.period || 'periodo').toLowerCase().replace(/[\/\s:]/g, '_');
    const filename = `RIMB_SPESE_AMM_${cleanSurname}_${cleanPeriod}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 6. GET /api/reports/:id/zip - Download renamed attachments ZIP
app.get('/api/reports/:id/zip', async (req, res) => {
  try {
    const db = readDb();
    const report = db.find(r => r.id === req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Sort items chronologically by date
    if (report.items) {
      report.items.sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date('9999-12-31');
        const dateB = b.date ? new Date(b.date) : new Date('9999-12-31');
        return dateA - dateB;
      });
    }

    const reportUploadDir = path.join(UPLOADS_DIR, report.id);
    const zip = new JSZip();
    let fileCount = 0;

    // Iterate through items and search for attachments
    report.items.forEach((item, index) => {
      const x = index + 1; // 1-based row index
      const clientClean = (item.client || 'Generico').trim().replace(/[^a-zA-Z0-9]/g, '_');
      
      let dateClean = '00_00_0000';
      if (item.date) {
        const parts = item.date.split('-');
        if (parts.length === 3) {
          dateClean = `${parts[2]}_${parts[1]}_${parts[0]}`;
        }
      }

      (item.attachments || []).forEach(att => {
        const filePath = path.join(reportUploadDir, att.fileName);
        if (fs.existsSync(filePath)) {
          const sanitizedOriginal = att.originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
          const prefix = item.reimbursementType === 'giustificativo' ? 'G' : 'RA';
          const finalName = `${x}_${prefix}_${clientClean}_${dateClean}_${sanitizedOriginal}`;
          const fileContent = fs.readFileSync(filePath);
          zip.file(finalName, fileContent);
          fileCount++;
        }
      });
    });

    if (fileCount === 0) {
      return res.status(400).json({ error: 'No attachments found for this report' });
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const cleanSurname = (report.profile.surname || 'martinelli').toLowerCase().replace(/\s+/g, '_');
    const cleanPeriod = (report.profile.period || 'periodo').toLowerCase().replace(/[\/\s:]/g, '_');
    const zipName = `Allegati_Rimborsi_${cleanSurname}_${cleanPeriod}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);
    res.send(zipBuffer);
  } catch (error) {
    console.error('Error generating ZIP:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 7. POST /api/analyze-attachment - Parse PDF text / file heuristics for OCR metadata
app.post('/api/analyze-attachment', upload.single('file'), async (req, res) => {
  try {
    let filePath;
    let originalName;
    let isTempFile = false; // If uploaded in this request, we delete it. If it was already a temp file from a draft, we don't delete it.

    if (req.file) {
      filePath = req.file.path;
      originalName = req.file.originalname;
      isTempFile = true;
    } else if (req.body.fileName) {
      filePath = path.join(UPLOADS_DIR, 'temp', req.body.fileName);
      originalName = req.body.originalName || req.body.fileName;
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File non trovato sul server' });
      }
    } else {
      return res.status(400).json({ error: 'Nessun file caricato o fornito' });
    }

    const extension = path.extname(originalName).toLowerCase();
    
    let text = '';
    let detectedType = 'generico';
    let detectedTotal = null;
    let detectedDate = null;
    let detectedClient = '';

    // Check document type from original filename
    const lowerName = originalName.toLowerCase();
    if (lowerName.includes('telepass')) detectedType = 'telepass';
    else if (lowerName.includes('autostrada') || lowerName.includes('pedaggio') || lowerName.includes('tratta')) detectedType = 'autostrada';
    else if (lowerName.includes('parcheggio') || lowerName.includes('parking') || lowerName.includes('sosta')) detectedType = 'parcheggio';
    else if (lowerName.includes('pasto') || lowerName.includes('ristorante') || lowerName.includes('pranzo') || lowerName.includes('cena') || lowerName.includes('bar') || lowerName.includes('cibo')) detectedType = 'pasto';

    if (extension === '.pdf') {
      try {
        const dataBuffer = fs.readFileSync(filePath);
        const parsed = await pdfParse(dataBuffer);
        text = parsed.text || '';
      } catch (err) {
        console.error('Error parsing PDF text:', err);
      }
    } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      try {
        const ocrResult = await Tesseract.recognize(filePath, 'ita+eng');
        text = ocrResult.data.text || '';
      } catch (err) {
        console.error('Error running Tesseract OCR on image:', err);
      }
    }

    // Try to find values from text if extracted, else fall back to filename heuristics
    if (text) {
      const lowerText = text.toLowerCase();

      // Check keywords for type
      if (lowerText.includes('telepass')) detectedType = 'telepass';
      else if (lowerText.includes('autostrada') || lowerText.includes('pedaggio') || lowerText.includes('casello')) detectedType = 'autostrada';
      else if (lowerText.includes('parcheggio') || lowerText.includes('sosta') || lowerText.includes('parking')) detectedType = 'parcheggio';
      else if (lowerText.includes('ristorante') || lowerText.includes('pasto') || lowerText.includes('pranzo') || lowerText.includes('cena') || lowerText.includes('trattoria') || lowerText.includes('pizzeria') || lowerText.includes('caffè') || lowerText.includes('bar ')) detectedType = 'pasto';

      // Helper functions to clean and parse numbers with layout space tolerances
      const cleanAndParseFloat = (numStr) => {
        let cleaned = numStr.replace(/\s+/g, '');
        if (cleaned.includes('.') && cleaned.includes(',')) {
          if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
          } else {
            cleaned = cleaned.replace(/,/g, '');
          }
        } else if (cleaned.includes(',')) {
          cleaned = cleaned.replace(',', '.');
        }
        return parseFloat(cleaned);
      };

      const extractNumberFromLine = (lineStr) => {
        const lowerLine = lineStr.toLowerCase();
        
        // 1. Look for decimal numbers with optional spaces around separator: e.g. 15 , 50 or 15,50
        const decimalRegex = /\b([0-9]+\s*[.,]\s*[0-9]{2})\b/g;
        const matches = [...lowerLine.matchAll(decimalRegex)];
        
        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1][1];
          const val = cleanAndParseFloat(lastMatch);
          if (!isNaN(val) && val > 0 && val < 1000) {
            return val;
          }
        }
        
        // 2. Look for integer/other numbers (avoiding years/percentages)
        const anyNumberRegex = /\b([0-9]+(?:\s*[.,]\s*[0-9]{1,2})?)\b/g;
        const matchesAny = [...lowerLine.matchAll(anyNumberRegex)];
        
        const validNumbers = matchesAny.map(m => m[1]).filter(numStr => {
          const val = cleanAndParseFloat(numStr);
          if (isNaN(val) || val <= 0 || val >= 1000) return false;
          if (val >= 2020 && val <= 2035) return false; // Skip years
          
          const idx = lowerLine.indexOf(numStr);
          if (idx !== -1 && lowerLine[idx + numStr.length] === '%') return false;
          return true;
        });
        
        if (validNumbers.length > 0) {
          const lastNum = validNumbers[validNumbers.length - 1];
          return cleanAndParseFloat(lastNum);
        }
        
        return null;
      };

      // Look for total amount - Method A: Bottom-up line-by-line keyword scanner
      const lines = text.split('\n');
      const totalKeywords = ['totale', 'total', 'tot', 'corrispettivo', 'pagato', 'importo', 'netto', 'dovuto', 'pedaggio'];
      
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const lowerLine = line.trim().toLowerCase();
        if (!lowerLine) continue;
        
        const hasKeyword = totalKeywords.some(kw => {
          const reg = new RegExp('\\b' + kw + '\\b|\\b' + kw + '\\.', 'i');
          return reg.test(lowerLine);
        });
        
        if (hasKeyword) {
          // A1. Check the same line
          let val = extractNumberFromLine(line);
          if (val !== null) {
            detectedTotal = val;
            break;
          }
          
          // A2. Check the line below (i + 1)
          if (i + 1 < lines.length) {
            val = extractNumberFromLine(lines[i + 1]);
            if (val !== null) {
              detectedTotal = val;
              break;
            }
          }
          
          // A3. Check two lines below (i + 2)
          if (i + 2 < lines.length) {
            val = extractNumberFromLine(lines[i + 2]);
            if (val !== null) {
              detectedTotal = val;
              break;
            }
          }
        }
      }

      // Method B: Fallback global regex search if bottom-up scanner found nothing
      if (detectedTotal === null) {
        const amountRegexes = [
          /(?:totale|total|importo\s+totale|importo|pagato|netto|corrispettivo|pedaggio)\s*(?:\beur\b|\b€\b)?\s*[:\-=]?\s*([0-9]+\s*[.,]\s*[0-9]{2})/gi,
          /(?:\beur\b|\b€\b)\s*[:\-=]?\s*([0-9]+\s*[.,]\s*[0-9]{2})/gi,
          /([0-9]+\s*[.,]\s*[0-9]{2})\s*(?:\beur\b|\b€\b)/gi
        ];

        for (const regex of amountRegexes) {
          let match;
          while ((match = regex.exec(text)) !== null) {
            const val = cleanAndParseFloat(match[1]);
            if (!isNaN(val) && val > 0 && val < 1000) {
              if (detectedTotal === null || val > detectedTotal) {
                detectedTotal = val;
              }
            }
          }
        }
      }

      // Look for dates: DD/MM/YYYY or DD-MM-YYYY
      const dateRegex = /\b([0-2]?[0-9]|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](20\d{2}|\d{2})\b/;
      const dateMatch = text.match(dateRegex);
      if (dateMatch) {
        let day = dateMatch[1].padStart(2, '0');
        let month = dateMatch[2].padStart(2, '0');
        let year = dateMatch[3];
        if (year.length === 2) year = '20' + year;
        detectedDate = `${year}-${month}-${day}`;
      }

      // Look for client name
      const clientRegex = /(?:spett\.le|spett|cliente|destinatario|diretto\s+a)\s*[:\-=]?\s*([A-Za-z0-9\s.,]{3,30})/i;
      const clientMatch = text.match(clientRegex);
      if (clientMatch) {
        detectedClient = clientMatch[1].trim();
      }
    }

    // Heuristics based on filename if PDF parsing yielded nothing or for images
    if (detectedTotal === null) {
      const fileAmountRegex = /(?:_|-|\s)([0-9]+[.,_][0-9]{2})(?:\.|$|_|-)/;
      const fileMatch = originalName.match(fileAmountRegex);
      if (fileMatch) {
        detectedTotal = parseFloat(fileMatch[1].replace('_', '.').replace(',', '.'));
      } else {
        const simpleAmountRegex = /\b([0-9]+[.,][0-9]{2})\b/;
        const simpleMatch = originalName.match(simpleAmountRegex);
        if (simpleMatch) {
          detectedTotal = parseFloat(simpleMatch[1].replace(',', '.'));
        }
      }
    }



    if (!detectedDate) {
      detectedDate = new Date().toISOString().split('T')[0];
    }

    // Clean up temporary uploaded file only if it was uploaded in this request
    if (isTempFile) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error('Error deleting temp file:', err);
      }
    }

    res.json({
      success: true,
      total: detectedTotal,
      date: detectedDate,
      type: detectedType,
      client: detectedClient || 'Cliente Generico'
    });

  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({ error: 'Errore durante l\'analisi del documento', details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  // Run initial Google Drive database sync
  driveHelper.syncDatabaseOnStartup();
});
