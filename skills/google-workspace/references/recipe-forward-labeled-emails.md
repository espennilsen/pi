# Forward Labeled Gmail Messages

Find messages with a specific label and forward them.

## Steps

1. Find labeled messages: `gws gmail users messages list --params '{"userId": "me", "q": "label:needs-review"}' --format table`
2. Get message content: `gws gmail users messages get --params '{"userId": "me", "id": "MSG_ID"}'`
3. Forward: `gws gmail +forward --message-id MSG_ID --to manager@company.com --body 'Forwarding for your review'`
