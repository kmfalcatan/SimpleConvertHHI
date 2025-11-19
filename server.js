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
const RATE_LIMIT_DELAY = 400; // milliseconds between each case upload
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/upload', upload.single('csvfile'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  // Check API key
  if (!API_KEY) {
    return res.status(500).send('API key not configured.');
  }

  const results = [];
  
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        // Process sequentially with rate limiting (150 cases per minute)
        const total = results.length;
        const processed = [];
        const failures = [];
        
        // Function to create a single case
        const createCase = async (row, index) => {
          let payload;
          try {
            payload = mapRowToPayload(row);
            
            // Validate required fields
            if (!payload.litigation_id) {
              throw new Error('Missing required field: litigation_id');
            }
            if (!payload.status_id) {
              throw new Error('Missing required field: status_id');
            }
            
            const response = await axios.post(`${API_BASE_URL}/cases`, payload, {
              headers: {
                'API-Key': API_KEY,
                'Content-Type': 'application/json'
              }
            });
            return { success: true, index, data: response.data };
          } catch (error) {
            // Log detailed error for debugging
            console.error(`Error creating case at row ${index + 1}:`, {
              message: error.message,
              response: error.response?.data,
              status: error.response?.status,
              payload: payload
            });
            
            // Return detailed error message
            const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
            return { success: false, index, error: errorMsg };
          }
        };
        
        // Process cases sequentially with rate limiting
        for (let i = 0; i < results.length; i++) {
          const result = await createCase(results[i], i);
          
          if (result.success) {
            processed.push(result);
          } else {
            failures.push(result);
          }
          
          // Add delay between requests (except after the last one)
          if (i < results.length - 1) {
            await delay(RATE_LIMIT_DELAY);
          }
          
          // Log progress every 10 cases
          if ((i + 1) % 10 === 0) {
            console.log(`Progress: ${i + 1}/${total} cases processed`);
          }
        }
        
        // Remove the uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({
          message: `Processed ${total} rows. Success: ${processed.length}, Failures: ${failures.length}`,
          failures: failures.map(f => ({
            row: f.index + 1,
            error: f.error
          }))
        });
      } catch (error) {
        // Remove the uploaded file
        fs.unlinkSync(req.file.path);
        res.status(500).send(`Error processing cases: ${error.message}`);
      }
    })
    .on('error', (error) => {
      // Remove the uploaded file
      fs.unlinkSync(req.file.path);
      res.status(500).send(`Error reading CSV: ${error.message}`);
    });
});

function mapRowToPayload(row) {
  const payload = {};
  
  // List of array fields
  const arrayFields = ['products', 'conditions', 'information', 'tags'];
  
  // Array fields that should contain integers
  const intArrayFields = ['conditions', 'information'];
  
  // List of date fields that need to be converted to yyyy-mm-dd
  const dateFields = ['birthday_injured', 'birthday', 'date_of_accident', 'incident_date'];
  
  // Helper function to convert date from m/d/yyyy to yyyy-mm-dd
  const formatDate = (dateStr) => {
    if (!dateStr || dateStr.trim() === '') return dateStr;
    
    // Try to parse m/d/yyyy format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
    
    // Return as-is if not in expected format
    return dateStr;
  };
  
  // Helper function to clean array values (remove brackets)
  const cleanArrayValue = (str) => {
    return str.replace(/^\[|\]$/g, '').trim();
  };
  
  for (const key in row) {
    if (row[key] === '') {
      // Skip empty values
      continue;
    }

    if (key === 'meta') {
      // Parse meta as JSON object
      try {
        const metaStr = row[key].trim();
        // Convert {gender: Male} to valid JSON
        const jsonStr = metaStr
          .replace(/\{/g, '{"')
          .replace(/:/g, '":"')
          .replace(/,\s*/g, '","')
          .replace(/\s*\}/g, '"}')
          .replace(/"\s+"/g, '":"');
        payload[key] = JSON.parse(jsonStr);
      } catch (error) {
        // If parsing fails, try alternative approach
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
        } catch (e) {
          // Last resort: keep as string
          payload[key] = row[key];
        }
      }
    } else if (arrayFields.includes(key)) {
      // Split by comma, trim, and remove brackets from each item
      const cleanedArray = row[key].split(',').map(item => cleanArrayValue(item));
      // Convert to integers if this is an integer array field
      if (intArrayFields.includes(key)) {
        payload[key] = cleanedArray.map(item => parseInt(item, 10)).filter(num => !isNaN(num));
      } else {
        payload[key] = cleanedArray;
      }
    } else if (dateFields.includes(key)) {
      // Convert date to yyyy-mm-dd format
      payload[key] = formatDate(row[key]);
    } else {
      payload[key] = row[key];
    }
  }
  
  // Always use environment-based values, overriding CSV values
  if (COMPANY_UUID) {
    payload.company_uuid = COMPANY_UUID;
  }
  if (REFERRED_FROM_COMPANY_UUID) {
    payload.referred_from_company_uuid = REFERRED_FROM_COMPANY_UUID;
  }
  if (TAGS) {
    payload.tags = [TAGS];
  }
  if (COUNSEL) {
    payload.counsel = COUNSEL;
  }
  if (FEESPLIT) {
    payload.feesplit = FEESPLIT;
  }
  if (TOTALFEE) {
    payload.totalfee = TOTALFEE;
  }
  
  return payload;
}

// POST endpoint to upload selected data rows
app.post('/upload-data', async (req, res) => {
  // Check API key
  if (!API_KEY) {
    return res.status(500).json({ message: 'API key not configured.' });
  }

  const { rows } = req.body;
  
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'No rows provided.' });
  }

  try {
    // Process sequentially with rate limiting (150 cases per minute)
    const total = rows.length;
    const processed = [];
    const failures = [];
    
    // Function to create a single case
    const createCase = async (row, index) => {
      let payload;
      try {
        payload = mapRowToPayload(row);
        
        // Validate required fields
        if (!payload.litigation_id) {
          throw new Error('Missing required field: litigation_id');
        }
        if (!payload.status_id) {
          throw new Error('Missing required field: status_id');
        }
        
        const response = await axios.post(`${API_BASE_URL}/cases`, payload, {
          headers: {
            'API-Key': API_KEY,
            'Content-Type': 'application/json'
          }
        });
        return { success: true, index, data: response.data };
      } catch (error) {
        // Log detailed error for debugging
        console.error(`Error creating case at row ${index + 1}:`, {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          payload: payload
        });
        
        // Return detailed error message
        const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
        return { success: false, index, error: errorMsg };
      }
    };
    
    // Process cases sequentially with rate limiting
    for (let i = 0; i < rows.length; i++) {
      const result = await createCase(rows[i], i);
      
      if (result.success) {
        processed.push(result);
      } else {
        failures.push(result);
      }
      
      // Add delay between requests (except after the last one)
      if (i < rows.length - 1) {
        await delay(RATE_LIMIT_DELAY);
      }
      
      // Log progress every 10 cases
      if ((i + 1) % 10 === 0) {
        console.log(`Progress: ${i + 1}/${total} cases processed`);
      }
    }
    
    res.json({
      message: `Processed ${total} rows. Success: ${processed.length}, Failures: ${failures.length}`,
      failures: failures.map(f => ({
        row: f.index + 1,
        error: f.error
      }))
    });
  } catch (error) {
    console.error('Error in /upload-data endpoint:', error);
    res.status(500).json({ 
      message: `Error processing cases: ${error.message}`,
      stack: error.stack
    });
  }
});

// GET endpoint to filter/query cases
app.get('/cases', async (req, res) => {
  // Check API key
  if (!API_KEY) {
    return res.status(500).json({ message: 'API key not configured.' });
  }

  try {
    // Build query parameters from request
    const params = {};
    
    // Map frontend filters to API parameters
    if (req.query.litigation_id) params.litigation_id = req.query.litigation_id;
    if (req.query.status_id) params.status_id = req.query.status_name;
    if (req.query.first_name) params.first_name = req.query.first_name;
    if (req.query.last_name) params.last_name = req.query.last_name;
    if (req.query.email) params.email = req.query.email;
    if (req.query.phone) params.phone = req.query.phone;
    if (req.query.date_from) params.date_from = req.query.date_from;
    if (req.query.date_to) params.date_to = req.query.date_to;
    if (req.query.tags) params.tags = req.query.tags;
    if (req.query.limit) params.limit = req.query.limit;

    // Make request to SimplyConvert API
    const response = await axios.get(`${API_BASE_URL}/cases`, {
      headers: {
        'API-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      params: params
    });

    res.json({
      cases: response.data.data || response.data || [],
      total: response.data.total || (response.data.data ? response.data.data.length : 0)
    });
  } catch (error) {
    console.error('Error fetching cases:', error.message);
    res.status(error.response?.status || 500).json({
      message: error.response?.data?.message || 'Error fetching cases',
      error: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
