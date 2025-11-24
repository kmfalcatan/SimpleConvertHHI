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

// POST endpoint to check for duplicates
app.post('/check-duplicates', async (req, res) => {
  // Check API key
  if (!API_KEY) {
    return res.status(500).json({ message: 'API key not configured.', duplicates: [] });
  }

  const { rows } = req.body;
  
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.json({ duplicates: [] });
  }

  try {
    const duplicates = [];
    
    console.log(`Checking ${rows.length} rows for duplicates...`);
    
    // Check each row for duplicates
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Get the required fields for duplicate checking
      const fname = row.fname_injured || row.fname || '';
      const lname = row.lname_injured || row.lname || '';
      const email = row.email_injured || row.email || '';
      
      console.log(`Row ${i}: Checking fname="${fname}", lname="${lname}", email="${email}"`);
      
      // Skip if all three fields are empty
      if (!fname && !lname && !email) {
        console.log(`Row ${i}: Skipped (all fields empty)`);
        continue;
      }
      
      try {
        // Build query string for exact matching
        // Using company_uuid to narrow down search
        const params = {
          company_uuid: COMPANY_UUID,
          limit: 100
        };
        
        // Add search parameters
        if (fname) params.fname_injured = fname;
        if (lname) params.lname_injured = lname;
        if (email) params.email_injured = email;
        
        console.log(`Row ${i}: Querying API with params:`, params);
        
        // Fetch ALL pages of results for this search - NO LIMIT
        let allCases = [];
        let page = 1;
        let hasMorePages = true;
        
        while (hasMorePages) {
          params.page = page;
          
          const response = await axios.get(`${API_BASE_URL}/cases`, {
            headers: {
              'API-Key': API_KEY,
              'Content-Type': 'application/json'
            },
            params: params,
            timeout: 30000 // 30 second timeout
          });
          
          const data = response.data;
          const cases = data.data || data || [];
          
          console.log(`Row ${i}, Page ${page}: Found ${cases.length} cases`);
          
          if (cases.length > 0) {
            allCases = allCases.concat(cases);
            
            // Check if there are more pages
            if (data.total) {
              hasMorePages = allCases.length < data.total;
              console.log(`Row ${i}: Progress ${allCases.length}/${data.total}`);
            } else if (data.last_page) {
              hasMorePages = page <= data.last_page;
            } else {
              // If we got less than the limit, we've reached the end
              hasMorePages = cases.length >= params.limit;
            }
            
            page++;
            
            // Small delay between pages to avoid rate limiting
            if (hasMorePages) {
              await delay(200);
            }
          } else {
            hasMorePages = false;
          }
          
          // Log every 10 pages
          if (page % 10 === 0) {
            console.log(`Row ${i}: Fetched ${page} pages so far, ${allCases.length} total cases`);
          }
        }
        
        console.log(`Row ${i}: FINISHED - Found ${allCases.length} total potential matches across ${page - 1} page(s)`);
        
        // If we found matching cases, check for exact match
        if (Array.isArray(allCases) && allCases.length > 0) {
          // Check if any case matches all provided fields (case-insensitive)
          const exactMatch = allCases.some(caseItem => {
            const fnameMatch = !fname || 
              (caseItem.fname_injured && caseItem.fname_injured.toLowerCase().trim() === fname.toLowerCase().trim());
            const lnameMatch = !lname || 
              (caseItem.lname_injured && caseItem.lname_injured.toLowerCase().trim() === lname.toLowerCase().trim());
            const emailMatch = !email || 
              (caseItem.email_injured && caseItem.email_injured.toLowerCase().trim() === email.toLowerCase().trim());
            
            return fnameMatch && lnameMatch && emailMatch;
          });
          
          if (exactMatch) {
            duplicates.push(i);
            console.log(`Row ${i}: DUPLICATE FOUND - ${fname} ${lname} ${email}`);
          } else {
            console.log(`Row ${i}: No exact match found`);
          }
        } else {
          console.log(`Row ${i}: No matches found`);
        }
        
        // Delay to avoid rate limiting (400ms same as upload rate)
        await delay(RATE_LIMIT_DELAY);
        
      } catch (error) {
        if (error.response?.status === 429) {
          console.error(`Row ${i}: Rate limited (429) - waiting 2 seconds...`);
          await delay(2000); // Wait 2 seconds on rate limit
          // Retry this row
          i--;
          continue;
        }
        console.error(`Error checking duplicate for row ${i}:`, error.message);
        if (error.response) {
          console.error(`Response status: ${error.response.status}`);
          console.error(`Response data:`, error.response.data);
        }
        // Continue checking other rows even if one fails
      }
    }
    
    console.log(`Duplicate check complete. Found ${duplicates.length} duplicates:`, duplicates);
    
    res.json({ duplicates });
    
  } catch (error) {
    console.error('Error in /check-duplicates endpoint:', error);
    res.status(500).json({ 
      message: `Error checking duplicates: ${error.message}`,
      duplicates: []
    });
  }
});

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

// ------------------- NEW FAST DUPLICATE CHECK ------------------- //
app.post('/check-duplicates', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ message: 'API key not configured.', duplicates: [] });

  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) return res.json({ duplicates: [] });

  try {
    console.log('Fetching all existing cases for duplicate check...');
    let allCases = [];
    let page = 1;
    let hasMorePages = true;

    const params = { company_uuid: COMPANY_UUID, limit: 100, fields: 'fname_injured,lname_injured,email_injured' };

    while (hasMorePages) {
      params.page = page;
      const response = await axios.get(`${API_BASE_URL}/cases`, {
        headers: { 'API-Key': API_KEY },
        params,
        timeout: 30000
      });
      const data = response.data;
      const cases = data.data || [];
      allCases = allCases.concat(cases);

      if (data.total) hasMorePages = allCases.length < data.total;
      else if (data.last_page) hasMorePages = page < data.last_page;
      else hasMorePages = cases.length >= params.limit;

      page++;
      if (hasMorePages) await delay(200);
    }

    console.log(`Total cases fetched: ${allCases.length}`);

    // Build in-memory lookup map
    const caseMap = new Map();
    allCases.forEach(c => {
      if (c.email_injured) caseMap.set(c.email_injured.toLowerCase(), c);
    });

    // Use concurrency limit for faster row checking
    const limit = pLimit(10);
    const tasks = rows.map((row, i) => limit(async () => {
      const fname = (row.fname_injured || row.fname || '').toLowerCase();
      const lname = (row.lname_injured || row.lname || '').toLowerCase();
      const email = (row.email_injured || row.email || '').toLowerCase();
      if (!fname && !lname && !email) return null;

      const existing = caseMap.get(email);
      if (existing && existing.fname_injured.toLowerCase() === fname && existing.lname_injured.toLowerCase() === lname) {
        return i;
      }
      return null;
    }));

    const duplicates = (await Promise.all(tasks)).filter(x => x !== null);
    console.log(`Duplicate check complete. Found ${duplicates.length} duplicates.`);

    res.json({ duplicates });

  } catch (error) {
    console.error('Error in /check-duplicates:', error);
    res.status(500).json({ message: error.message, duplicates: [] });
  }
});

// GET endpoint to filter/query cases - Fetches ALL cases with pagination
app.get('/cases', async (req, res) => {
  // Check API key
  if (!API_KEY) {
    return res.status(500).json({ message: 'API key not configured.' });
  }

  try {
    // Build query parameters from request
    const params = {
      limit: 100 // Set a high limit per page
    };
    
    // Map frontend filters to API parameters
    if (req.query.litigationId) params.litigation_id = req.query.litigationId;
    if (req.query.statusId) params.status_id = req.query.statusId;
    if (req.query.firstName) params.fname_injured = req.query.firstName;
    if (req.query.lastName) params.lname_injured = req.query.lastName;
    if (req.query.emailAddress) params.email_injured = req.query.emailAddress;
    if (req.query.phoneNumber) params.phone = req.query.phoneNumber;
    if (req.query.createdAtStart) params.created_at_start = req.query.createdAtStart;
    if (req.query.createdAtEnd) params.created_at_end = req.query.createdAtEnd;
    if (req.query.tag) params.tag = req.query.tag;
    
    // Add company_uuid to filter by company
    if (COMPANY_UUID) {
      params.company_uuid = COMPANY_UUID;
    }

    console.log('Fetching cases with params:', params);

    let allCases = [];
    let page = 1;
    let hasMorePages = true;

    // Fetch all pages
    while (hasMorePages) {
      params.page = page;
      
      console.log(`Fetching page ${page}...`);
      
      const response = await axios.get(`${API_BASE_URL}/cases`, {
        headers: {
          'API-Key': API_KEY,
          'Content-Type': 'application/json'
        },
        params: params,
        timeout: 30000 // 30 second timeout
      });

      const data = response.data;
      const cases = data.data || data || [];
      
      console.log(`Page ${page}: Found ${cases.length} cases`);
      
      if (cases.length > 0) {
        allCases = allCases.concat(cases);
        page++;
        
        // Check if there are more pages
        // Some APIs return total count, current page info, or just return empty array when done
        if (data.total) {
          hasMorePages = allCases.length < data.total;
        } else if (data.last_page) {
          hasMorePages = page <= data.last_page;
        } else {
          // If we got less than the limit, we've reached the end
          hasMorePages = cases.length >= params.limit;
        }
        
        // Add small delay to avoid rate limiting
        if (hasMorePages) {
          await delay(200);
        }
      } else {
        hasMorePages = false;
      }
      
      // Safety limit to prevent infinite loops
      if (page > 100) {
        console.log('Reached maximum page limit (100)');
        hasMorePages = false;
      }
    }

    console.log(`Total cases fetched: ${allCases.length}`);

    res.json({
      cases: allCases,
      total: allCases.length
    });
  } catch (error) {
    console.error('Error fetching cases:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    res.status(error.response?.status || 500).json({
      message: error.response?.data?.message || 'Error fetching cases',
      error: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});