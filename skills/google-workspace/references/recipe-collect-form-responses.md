# Check Form Responses

Retrieve and review responses from a Google Form.

## Steps

1. Get form details: `gws forms forms get --params '{"formId": "FORM_ID"}'`
2. Get responses: `gws forms forms responses list --params '{"formId": "FORM_ID"}' --format table`
