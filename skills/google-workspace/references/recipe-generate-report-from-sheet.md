# Generate a Google Docs Report from Sheet Data

Read data from a Sheet and create a formatted Docs report.

## Steps

1. Read the data: `gws sheets +read --spreadsheet SHEET_ID --range "Sales!A1:D"`
2. Create the report doc: `gws docs documents create --json '{"title": "Sales Report - January 2025"}'`
3. Write the report: `gws docs +write --document DOC_ID --text '## Sales Report\n\n### Summary\nTotal deals: 45\nRevenue: $125,000'`
4. Share: `gws drive permissions create --params '{"fileId": "DOC_ID"}' --json '{"role": "reader", "type": "user", "emailAddress": "cfo@company.com"}'`
