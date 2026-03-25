# Copy a Google Sheet for a New Month

Duplicate a template tab for a new month.

## Steps

1. Get spreadsheet details: `gws sheets spreadsheets get --params '{"spreadsheetId": "SHEET_ID"}'`
2. Copy the template sheet: `gws sheets spreadsheets sheets copyTo --params '{"spreadsheetId": "SHEET_ID", "sheetId": 0}' --json '{"destinationSpreadsheetId": "SHEET_ID"}'`
3. Rename the new tab (replace `NEW_SHEET_ID` with the `sheetId` from the step 2 response): `gws sheets spreadsheets batchUpdate --params '{"spreadsheetId": "SHEET_ID"}' --json '{"requests": [{"updateSheetProperties": {"properties": {"sheetId": NEW_SHEET_ID, "title": "February 2025"}, "fields": "title"}}]}'`
