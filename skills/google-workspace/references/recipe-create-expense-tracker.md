# Create a Google Sheets Expense Tracker

Set up a spreadsheet for tracking expenses.

## Steps

1. Create spreadsheet: `gws drive files create --json '{"name": "Expense Tracker 2025", "mimeType": "application/vnd.google-apps.spreadsheet"}'`
2. Add headers: `gws sheets +append --spreadsheet SHEET_ID --values 'Date,Category,Description,Amount'`
3. Add first entry: `gws sheets +append --spreadsheet SHEET_ID --values '2025-01-15,Travel,Flight to NYC,450.00'`
4. Share with manager: `gws drive permissions create --params '{"fileId": "SHEET_ID"}' --json '{"role": "reader", "type": "user", "emailAddress": "manager@company.com"}'`
