# SimplyConvert API Integration

A Node.js Express application that provides a web interface and API integration for bulk uploading cases to SimplyConvert's case management system.

## System Description

This application serves as a middleware bridge between CSV data sources and the SimplyConvert API. It provides:

- **Web-based CSV upload interface** for bulk case creation
- **Data preview and validation** before submission
- **Rate-limited API requests** to comply with SimplyConvert's API limits (150 cases/minute)
- **Error handling and reporting** for failed uploads
- **Case filtering and querying** capabilities
- **Automatic data mapping and transformation** from CSV to SimplyConvert's required format

## Features

### 1. CSV File Upload (`/upload`)
- Upload CSV files containing case data
- Automatically parses and validates CSV structure
- Processes cases sequentially with rate limiting (400ms delay between requests)
- Returns detailed success/failure report for each case
- Supports large files (up to 100MB)

### 2. Direct Data Upload (`/upload-data`)
- Upload pre-parsed JSON data directly
- Allows selective upload of specific rows
- Same rate limiting and error handling as CSV upload
- Useful for programmatic integration

### 3. Case Querying (`/cases`)
- Filter and retrieve cases from SimplyConvert
- Supports various query parameters:
  - `litigation_id` - Filter by litigation type
  - `status_id` - Filter by case status
  - `first_name`, `last_name` - Filter by client name
  - `email`, `phone` - Filter by contact information
  - `date_from`, `date_to` - Filter by date range
  - `tags` - Filter by tags
  - `limit` - Limit number of results

### 4. Data Transformation

The application automatically handles:

- **Date formatting**: Converts `M/D/YYYY` to `YYYY-MM-DD`
- **Array parsing**: Handles comma-separated values for fields like products, conditions, tags
- **Integer arrays**: Converts string arrays to integer arrays for specific fields
- **Meta object parsing**: Converts string representations of objects to proper JSON
- **Environment variable injection**: Automatically applies configured defaults (company UUID, tags, etc.)

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- SimplyConvert API key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd SimplyConvertAPI
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables (see Configuration section)

4. Start the server:
```bash
node server.js
```

The server will start on port 3000 by default (or the port specified in `.env`).

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Required
API_KEY=your_simplyconvert_api_key

# Optional - Default values to apply to all cases
COMPANY_UUID=your_company_uuid
REFERRED_FROM_COMPANY_UUID=referring_company_uuid
TAGS=your_default_tag
COUNSEL=counsel_name
FEESPLIT=fee_split_value
TOTALFEE=total_fee_value

# Server Configuration
PORT=3000
```

See `.env.example` for a template.

## Usage

### Web Interface

1. Navigate to `http://localhost:3000` in your browser
2. Upload a CSV file with case data
3. Review the parsed data in the preview
4. Click "Upload to SimplyConvert" to process all cases
5. View the results report showing successes and failures

### CSV Format

Your CSV should include columns matching SimplyConvert's case fields. Common fields include:

- `litigation_id` (required) - Litigation type identifier
- `status_id` (required) - Case status identifier
- `first_name`, `last_name` - Client information
- `email`, `phone` - Contact information
- `birthday`, `birthday_injured` - Date fields (M/D/YYYY format)
- `date_of_accident`, `incident_date` - Date fields (M/D/YYYY format)
- `products`, `conditions`, `information`, `tags` - Array fields (comma-separated)
- `meta` - JSON object for additional metadata

### API Endpoints

#### POST `/upload`
Upload a CSV file for processing.

**Request**: `multipart/form-data` with file field named `csvfile`

**Response**:
```json
{
  "message": "Processed 100 rows. Success: 98, Failures: 2",
  "failures": [
    { "row": 15, "error": "Missing required field: status_id" },
    { "row": 42, "error": "Invalid litigation_id" }
  ]
}
```

#### POST `/upload-data`
Upload pre-parsed JSON data.

**Request**:
```json
{
  "rows": [
    {
      "litigation_id": "123",
      "status_id": "456",
      "first_name": "John",
      "last_name": "Doe"
    }
  ]
}
```

**Response**: Same as `/upload` endpoint

#### GET `/cases`
Query cases from SimplyConvert.

**Query Parameters**: See Features section for available filters

**Response**:
```json
{
  "cases": [...],
  "total": 50
}
```

## Rate Limiting

The application implements rate limiting to comply with SimplyConvert's API restrictions:

- **Limit**: 150 cases per minute
- **Delay**: 400ms between each case upload
- **Processing**: Sequential (one case at a time)

Progress is logged to the console every 10 cases.

## Error Handling

The application provides detailed error reporting:

- **Row-level errors**: Each failed case includes the row number and specific error message
- **Validation errors**: Catches missing required fields before API submission
- **API errors**: Reports SimplyConvert API error messages
- **File errors**: Handles CSV parsing errors gracefully

## Project Structure

```
SimplyConvertAPI/
├── server.js              # Main Express server and API logic
├── package.json           # Dependencies and scripts
├── .env                   # Environment configuration
├── .env.example           # Environment template
├── public/                # Web interface files
│   ├── index.html        # Main upload interface
│   ├── script.js         # Upload interface logic
│   ├── filter.html       # Case filtering interface
│   └── filter.js         # Filter interface logic
├── uploads/              # Temporary storage for uploaded CSV files
├── simplyconvertapiv2.apib  # API documentation
└── README.md             # This file
```

## Development

### Adding New Fields

To add support for new CSV fields:

1. Update the `mapRowToPayload` function in `server.js`
2. Add to appropriate field type arrays (`arrayFields`, `dateFields`, etc.)
3. Add any custom transformation logic if needed

### Modifying Rate Limiting

Adjust the `RATE_LIMIT_DELAY` constant in `server.js`:

```javascript
const RATE_LIMIT_DELAY = 400; // milliseconds between requests
```

## Troubleshooting

### API Key Issues
- Ensure your API key is correctly set in `.env`
- Verify the API key has necessary permissions in SimplyConvert

### Upload Failures
- Check that required fields (`litigation_id`, `status_id`) are present
- Verify date formats match M/D/YYYY
- Ensure array values are comma-separated
- Check console logs for detailed error messages

### Rate Limiting
- If you experience timeout errors, the delay may need to be increased
- Monitor the console for progress updates during large uploads

## License

[Add your license information here]

## Support

For issues or questions:
- Check the SimplyConvert API documentation (`simplyconvertapiv2.apib`)
- Review console logs for detailed error messages
- Contact [your support contact information]
