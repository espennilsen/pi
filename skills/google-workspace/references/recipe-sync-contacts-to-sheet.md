# Export Google Contacts to Sheets

Export Google Contacts directory to a spreadsheet.

## Steps

1. List contacts: `gws people people listDirectoryPeople --params '{"readMask": "names,emailAddresses,phoneNumbers", "sources": ["DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE"], "pageSize": 100}' --format json`
2. Create headers: `gws sheets +append --spreadsheet SHEET_ID --values 'Name,Email,Phone'`
3. Append each contact: `gws sheets +append --spreadsheet SHEET_ID --values 'Jane Doe,jane@company.com,+1-555-0100'`
