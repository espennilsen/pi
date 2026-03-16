# Save Gmail Attachments to Google Drive

Find messages with attachments and save them to Drive.

## Steps

1. Search for emails with attachments: `gws gmail users messages list --params '{"userId": "me", "q": "has:attachment from:client@example.com"}' --format table`
2. Get message details: `gws gmail users messages get --params '{"userId": "me", "id": "MESSAGE_ID"}'`
3. Download attachment: `gws gmail users messages attachments get --params '{"userId": "me", "messageId": "MESSAGE_ID", "id": "ATTACHMENT_ID"}' -o attachment.pdf`
4. Upload to Drive: `gws drive +upload ./attachment.pdf --parent FOLDER_ID`
