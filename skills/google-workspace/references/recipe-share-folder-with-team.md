# Share a Google Drive Folder with a Team

Share a folder and all its contents with collaborators.

## Steps

1. Find the folder: `gws drive files list --params '{"q": "name = '\''Project X'\'' and mimeType = '\''application/vnd.google-apps.folder'\''"}'`
2. Share as editor: `gws drive permissions create --params '{"fileId": "FOLDER_ID"}' --json '{"role": "writer", "type": "user", "emailAddress": "colleague@company.com"}'`
3. Share as viewer: `gws drive permissions create --params '{"fileId": "FOLDER_ID"}' --json '{"role": "reader", "type": "user", "emailAddress": "stakeholder@company.com"}'`
4. Verify permissions: `gws drive permissions list --params '{"fileId": "FOLDER_ID"}' --format table`
