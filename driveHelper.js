const fs = require('fs');
const path = require('path');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxPcpndJ8fehbaLEuZS-NjvvZ5dMBl5-QLeSNMVgqYjFXDMZgLnPGU6A7BvPmIrRYFB/exec';
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');

async function syncDatabaseOnStartup() {
  try {
    console.log('Google Drive Sync: avvio sincronizzazione iniziale tramite Apps Script...');
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'readDb' }),
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    
    // Save locally
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.log('Google Drive Sync: db.json scaricato ed applicato con successo da Drive.');
  } catch (error) {
    console.error('Google Drive Sync: errore sincronizzazione iniziale database:', error);
  }
}

async function uploadDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) return;
    const localData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'writeDb',
        data: localData
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      console.log('Google Drive Sync: db.json aggiornato su Drive.');
    } else {
      console.error('Google Drive Sync: errore caricamento db.json:', response.statusText);
    }
  } catch (error) {
    console.error('Google Drive Sync: errore caricamento db.json:', error);
  }
}

async function uploadAttachment(reportId, fileName) {
  try {
    const localPath = path.join(UPLOADS_DIR, reportId, fileName);
    if (!fs.existsSync(localPath)) {
      console.warn(`Google Drive Sync: file locale non trovato per il caricamento: ${localPath}`);
      return;
    }

    const fileBuffer = fs.readFileSync(localPath);
    const base64 = fileBuffer.toString('base64');
    
    // Detect mimeType
    const ext = path.extname(fileName).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'uploadFile',
        reportId,
        fileName,
        fileBase64: base64,
        mimeType
      }),
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      console.log(`Google Drive Sync: file ${fileName} caricato nella cartella ${reportId} su Drive.`);
    } else {
      console.error(`Google Drive Sync: errore caricamento file ${fileName}:`, response.statusText);
    }
  } catch (error) {
    console.error(`Google Drive Sync: errore caricamento allegato ${fileName}:`, error);
  }
}

async function uploadTempAttachment(fileName) {
  try {
    const localPath = path.join(UPLOADS_DIR, 'temp', fileName);
    if (!fs.existsSync(localPath)) return;

    const fileBuffer = fs.readFileSync(localPath);
    const base64 = fileBuffer.toString('base64');
    
    // Detect mimeType
    const ext = path.extname(fileName).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'uploadFile',
        reportId: 'temp',
        fileName,
        fileBase64: base64,
        mimeType
      }),
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      console.log(`Google Drive Sync: file temporaneo ${fileName} caricato su Drive.`);
    }
  } catch (error) {
    console.error(`Google Drive Sync: errore caricamento file temporaneo ${fileName}:`, error);
  }
}

async function downloadFileFromDriveIfMissing(reportId, fileName) {
  try {
    const localDir = path.join(UPLOADS_DIR, reportId);
    const localPath = path.join(localDir, fileName);
    if (fs.existsSync(localPath)) return true;

    console.log(`Google Drive Sync: download del file mancante localmente ${fileName} da Drive...`);
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'downloadFile',
        reportId,
        fileName
      }),
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) return false;
    const result = await response.json();
    if (result.error || !result.fileBase64) {
      console.warn(`Google Drive Sync: file non trovato o errore da Drive per ${fileName}`);
      return false;
    }

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const fileBuffer = Buffer.from(result.fileBase64, 'base64');
    fs.writeFileSync(localPath, fileBuffer);
    console.log(`Google Drive Sync: file ${fileName} ripristinato con successo da Drive.`);
    return true;
  } catch (error) {
    console.error(`Google Drive Sync: errore download file ${fileName}:`, error);
    return false;
  }
}

module.exports = {
  syncDatabaseOnStartup,
  uploadDatabase,
  uploadAttachment,
  uploadTempAttachment,
  downloadFileFromDriveIfMissing
};
