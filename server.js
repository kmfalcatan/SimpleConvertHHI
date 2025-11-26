require('dotenv').config({ path: './.env' });
const express = require('express');
const path = require('path');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const axios = require('axios');


const app = express();
const port = process.env.PORT || 3000;


// Parse JSON bodies with increased limit for large CSV data
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));


// Configure multer for file upload
const upload = multer({ dest: path.join(__dirname, 'uploads/') });


// Environment variables
const API_KEY = process.env.API_KEY;
const COMPANY_UUID = process.env.COMPANY_UUID;
const REFERRED_FROM_COMPANY_UUID = process.env.REFERRED_FROM_COMPANY_UUID;
const TAGS = process.env.TAGS;
const COUNSEL = process.env.COUNSEL;
const FEESPLIT = process.env.FEESPLIT;
const TOTALFEE = process.env.TOTALFEE;
const API_BASE_URL = 'https://simplyconvert.com/api/v2';

// Rate limiting configuration: 150 cases per minute = 400ms per case
const RATE_LIMIT_DELAY = 400;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch all cases from SimplyConvert API
async function fetchAllSimplyConvertCases() {
  if (!API_KEY) return [];

  try {
    let allCases = [];
    let page = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const res = await axios.get(`${API_BASE_URL}/cases`, {
        headers: { "API-Key": API_KEY },
        params: { limit, page },
        timeout: 30000
      });

      const cases = res.data.data || [];
      allCases = allCases.concat(cases);

      hasMore = cases.length > 0 && (cases.length === limit || res.data.hasMore === true);
      page++;

      if (hasMore) await delay(200);
    }

    return allCases;

  } catch (err) {
    console.error("[ERROR] Failed to fetch cases:", err.message);
    return [];
  }
}

// Check for duplicates
app.post('/check-duplicates', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ message: 'API key not configured.', duplicates: [] });
  }

  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.json({ duplicates: [] });
  }

  try {
    const allCases = await fetchAllSimplyConvertCases();
    const duplicates = [];

    rows.forEach((row, index) => {
      const fname = (row.fname_injured || row.fname || '').toLowerCase();
      const lname = (row.lname_injured || row.lname || '').toLowerCase();
      const email = (row.email_injured || row.email || '').toLowerCase();

      if (!fname && !lname && !email) return;

      const isDuplicate = allCases.some(caseItem => {
        const matchesFname = !fname || (caseItem.fname_injured && caseItem.fname_injured.toLowerCase() === fname);
        const matchesLname = !lname || (caseItem.lname_injured && caseItem.lname_injured.toLowerCase() === lname);
        const matchesEmail = !email || (caseItem.email_injured && caseItem.email_injured.toLowerCase() === email);

        return matchesFname && matchesLname && matchesEmail;
      });

      if (isDuplicate) duplicates.push(index);
    });

    res.json({
      duplicates,
      totalRowsChecked: rows.length,
      totalExistingCases: allCases.length
    });
  } catch (error) {
    console.error('Error in /check-duplicates endpoint:', error);
    res.status(500).json({
      message: `Error checking duplicates: ${error.message}`,
      duplicates: []
    });
  }
});

// Upload CSV
app.post('/upload', upload.single('csvfile'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  if (!API_KEY) return res.status(500).send('API key not configured.');

  const results = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {

        const total = results.length;
        const processed = [];
        const failures = [];

        const createCase = async (row, index) => {
          let payload;
          try {
            payload = mapRowToPayload(row);

            if (!payload.litigation_id) throw new Error('Missing required field: litigation_id');
            if (!payload.status_id) throw new Error('Missing required field: status_id');

            const response = await axios.post(`${API_BASE_URL}/cases`, payload, {
              headers: { 'API-Key': API_KEY, 'Content-Type': 'application/json' }
            });

            return { success: true, index, data: response.data };
          } catch (error) {

            const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
            return { success: false, index, error: errorMsg };
          }
        };

        for (let i = 0; i < results.length; i++) {
          const result = await createCase(results[i], i);
          if (result.success) processed.push(result);
          else failures.push(result);

          if (i < results.length - 1) await delay(RATE_LIMIT_DELAY);
        }

        fs.unlinkSync(req.file.path);

        res.json({
          message: `Processed ${total} rows. Success: ${processed.length}, Failures: ${failures.length}`,
          failures: failures.map(f => ({ row: f.index + 1, error: f.error }))
        });
      } catch (error) {
       
        fs.unlinkSync(req.file.path);
        res.status(500).send(`Error processing cases: ${error.message}`);
      }
    })
    .on('error', (error) => {

      fs.unlinkSync(req.file.path);
      res.status(500).send(`Error reading CSV: ${error.message}`);
    });
});

function mapRowToPayload(row) {
    const payload = {};
    const arrayFields = ['products', 'conditions', 'information', 'tags'];
    const intArrayFields = ['conditions', 'information'];
    const dateFields = ['birthday_injured', 'birthday', 'date_of_accident', 'incident_date'];

  const formatDate = (dateStr) => {
    if (!dateStr || dateStr.trim() === '') return dateStr;
      const parts = dateStr.split('/');
    if (parts.length === 3) {
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
      return dateStr;
  };

  const cleanArrayValue = (str) => str.replace(/^\[|\]$/g, '').trim();

  for (const key in row) {
    if (row[key] === '') continue;

    if (key === 'meta') {

      try {
          const metaStr = row[key].trim();
          const jsonStr = metaStr
          .replace(/\{/g, '{"')
          .replace(/:/g, '":"')
          .replace(/,\s*/g, '","')
          .replace(/\s*\}/g, '"}')
          .replace(/"\s+"/g, '":"');
        payload[key] = JSON.parse(jsonStr);
      }
      catch (error) {
        try {
          const cleanedMeta = row[key]
            .replace(/\{|\}/g, '')
            .trim()
            .split(',')
            .reduce((obj, pair) => {
              const [k, v] = pair.split(':').map(s => s.trim());
              if (k && v) obj[k] = v;
              return obj;
            }, {});
          payload[key] = cleanedMeta;
        }
        catch (e) {
          payload[key] = row[key];
        }
      }
    }
      else if (arrayFields.includes(key)) {
      const cleanedArray = row[key].split(',').map(item => cleanArrayValue(item));
      payload[key] = intArrayFields.includes(key) ? cleanedArray.map(item => parseInt(item, 10)).filter(n => !isNaN(n)) : cleanedArray;
    }
      else if (dateFields.includes(key)) {
      payload[key] = formatDate(row[key]);
    } else {
      payload[key] = row[key];
    }
  }

  if (COMPANY_UUID) payload.company_uuid = COMPANY_UUID;
  if (REFERRED_FROM_COMPANY_UUID) payload.referred_from_company_uuid = REFERRED_FROM_COMPANY_UUID;
  if (TAGS) payload.tags = [TAGS];
  if (COUNSEL) payload.counsel = COUNSEL;
  if (FEESPLIT) payload.feesplit = FEESPLIT;
  if (TOTALFEE) payload.totalfee = TOTALFEE;

  return payload;
}

// POST endpoint to upload selected data rows
app.post('/upload-data', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ message: 'API key not configured.' });

  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) return res.status(400).json({ message: 'No rows provided.' });

    try {
    const total = rows.length;
    const processed = [];
    const failures = [];

    const createCase = async (row, index) => {
      let payload;
      try {
        payload = mapRowToPayload(row);
        if (!payload.litigation_id) throw new Error('Missing required field: litigation_id');
        if (!payload.status_id) throw new Error('Missing required field: status_id');

        const response = await axios.post(`${API_BASE_URL}/cases`, payload, {
          headers: { 'API-Key': API_KEY, 'Content-Type': 'application/json' }
        });

        return { success: true, index, data: response.data };
      }
        catch (error) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
        return { success: false, index, error: errorMsg };
      }
    };

    for (let i = 0; i < rows.length; i++) {
      const result = await createCase(rows[i], i);
      if (result.success) processed.push(result);
      else failures.push(result);
      if (i < rows.length - 1) await delay(RATE_LIMIT_DELAY);
    }

    res.json({
      message: `Processed ${total} rows. Success: ${processed.length}, Failures: ${failures.length}`,
      failures: failures.map(f => ({ row: f.index + 1, error: f.error }))
    });
  } catch (error) {
    res.status(500).json({ message: `Error processing cases: ${error.message}`, stack: error.stack });
  }
});

// GET endpoint to filter/query cases
app.get('/cases', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ message: 'API key not configured.' });

  try {
    const params = { limit: 100 };

    if (req.query.litigationId) params.litigation_id = req.query.litigationId;
    if (req.query.statusId) params.status_id = req.query.statusId;
    if (req.query.firstName) params.fname_injured = req.query.firstName;
    if (req.query.lastName) params.lname_injured = req.query.lastName;
    if (req.query.emailAddress) params.email_injured = req.query.emailAddress;
    if (req.query.phoneNumber) params.phone = req.query.phoneNumber;
    if (req.query.createdAtStart) params.created_at_start = req.query.createdAtStart;
    if (req.query.createdAtEnd) params.created_at_end = req.query.createdAtEnd;
    if (req.query.tag) params.tag = req.query.tag;
    if (COMPANY_UUID) params.company_uuid = COMPANY_UUID;

    let allCases = [];
    let page = 0;
    let hasMorePages = true;
    const maxRequests = 500;
    let requestCount = 0;

    while (hasMorePages && requestCount < maxRequests) {
      params.page = page;
      requestCount++;

      const response = await axios.get(`${API_BASE_URL}/cases`, {
        headers: { 'API-Key': API_KEY, 'Content-Type': 'application/json' },
        params,
        timeout: 30000
      });

      const cases = response.data.data || [];
      if (cases.length > 0) allCases = allCases.concat(cases);

      hasMorePages = cases.length > 0 && (cases.length === params.limit || response.data.hasMore === true);
      page++;
      if (hasMorePages) await delay(200);
    }

    res.json({ cases: allCases, total: allCases.length, requestsMade: requestCount });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching cases', error: error.message });
  }
});

// Start server
app.listen(port);