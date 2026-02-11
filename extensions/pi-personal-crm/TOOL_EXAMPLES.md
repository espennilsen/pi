# CRM Tool Examples

Examples of using the CRM tool in Pi agent prompts.

## Search Contacts

```
Search for John in CRM
```

Tool call:
```json
{
  "tool": "crm",
  "action": "search",
  "query": "John"
}
```

Returns:
```
🔍 Search results for "John":

**Contacts (1):**
- John Doe @ Acme Corp <john@acme.example> (ID: 1)
```

## Get Contact Details

```
Tell me about John Doe
```

Tool call:
```json
{
  "tool": "crm",
  "action": "contact",
  "name": "John Doe"
}
```

Returns:
```
👤 **John Doe**

📧 john@acme.example
📞 +1234567890
🏢 Acme Corp
🎂 Birthday: 1990-05-15
🏷️  Tags: vip,client

**Recent Interactions (1):**
- call (2/10/2026): Discussed Q4 roadmap
  Follow up in 2 weeks

**Reminders:**
- birthday: 2026-05-15 — Wish John a happy birthday!

**Groups:**
- VIP Clients — High-value customers

_Contact ID: 1_
```

## Add a Contact

```
Add Sarah Johnson to CRM:
- Email: sarah@techstartup.io
- Phone: +44 20 1234 5678
- Company: TechStartup (create if needed)
- Tags: prospect, developer
- Birthday: 1992-08-20
```

Tool call:
```json
{
  "tool": "crm",
  "action": "add_contact",
  "first_name": "Sarah",
  "last_name": "Johnson",
  "email": "sarah@techstartup.io",
  "phone": "+44 20 1234 5678",
  "company_name": "TechStartup",
  "tags": "prospect,developer",
  "birthday": "1992-08-20"
}
```

Returns:
```
✅ Created contact: Sarah Johnson (ID: 2)
```

## Update a Contact

```
Update John's tags to include "enterprise" and change notes to "Key account - high value"
```

Tool call:
```json
{
  "tool": "crm",
  "action": "update_contact",
  "contact_id": 1,
  "tags": "vip,client,enterprise",
  "notes": "Key account - high value"
}
```

Returns:
```
✅ Updated contact: John Doe
```

## Delete a Contact

```
Remove the old test contact (ID 99)
```

Tool call:
```json
{
  "tool": "crm",
  "action": "delete_contact",
  "contact_id": 99
}
```

Returns:
```
✅ Deleted contact: Test User (ID: 99)
```

## Log an Interaction

```
Log a call with John (ID 1): Discussed renewal, closing Q1 2026
```

Tool call:
```json
{
  "tool": "crm",
  "action": "log_interaction",
  "contact_id": 1,
  "interaction_type": "call",
  "summary": "Discussed renewal, closing Q1 2026"
}
```

Returns:
```
✅ Logged call with John Doe: Discussed renewal, closing Q1 2026
```

## Add a Reminder

```
Set a reminder for Sarah's birthday on 2026-08-20
```

Tool call:
```json
{
  "tool": "crm",
  "action": "add_reminder",
  "contact_id": 2,
  "reminder_type": "birthday",
  "reminder_date": "2026-08-20",
  "reminder_message": "Wish Sarah a happy birthday!"
}
```

Returns:
```
✅ Added birthday reminder for Sarah Johnson on 2026-08-20
```

## View Upcoming Reminders

```
What's coming up in the next week?
```

Tool call:
```json
{
  "tool": "crm",
  "action": "upcoming",
  "days": 7
}
```

Returns:
```
📅 Upcoming reminders (next 7 days):

- 2026-05-15: birthday — John Doe (Wish John a happy birthday!)
```

## Add a Relationship

```
John and Sarah are colleagues
```

Tool call:
```json
{
  "tool": "crm",
  "action": "add_relationship",
  "contact_id": 1,
  "related_contact_id": 2,
  "relationship_type": "colleague"
}
```

Returns:
```
✅ Added relationship: John Doe ↔ Sarah Johnson (colleague)
```

## List Companies

```
Show all companies in CRM
```

Tool call:
```json
{
  "tool": "crm",
  "action": "list_companies"
}
```

Returns:
```
🏢 Companies (2):

- Acme Corp [Technology] — https://acme.example (ID: 1)
- TechStartup — (ID: 2)
```

## Add a Company

```
Add a new company: DataFlow Labs, fintech, https://dataflow.example
```

Tool call:
```json
{
  "tool": "crm",
  "action": "add_company",
  "company_name": "DataFlow Labs",
  "industry": "Fintech",
  "website": "https://dataflow.example"
}
```

Returns:
```
✅ Created company: DataFlow Labs (ID: 3)
```

## List Groups

```
What groups do we have?
```

Tool call:
```json
{
  "tool": "crm",
  "action": "list_groups"
}
```

Returns:
```
📂 Groups (2):

- VIP Clients — High-value customers (3 members, ID: 1)
- Newsletter — Monthly newsletter subscribers (12 members, ID: 2)
```

## Add to Group

```
Add John to the VIP Clients group
```

Tool call:
```json
{
  "tool": "crm",
  "action": "add_to_group",
  "contact_id": 1,
  "group_name": "VIP Clients"
}
```

Returns:
```
✅ Added John Doe to group "VIP Clients"
```

If the group doesn't exist, it's created automatically:

```json
{
  "tool": "crm",
  "action": "add_to_group",
  "contact_id": 1,
  "group_name": "Beta Testers",
  "group_description": "Users in the beta program"
}
```

Returns:
```
✅ Added John Doe to group "Beta Testers"
```

## Remove from Group

```
Remove Sarah from the Newsletter group
```

Tool call:
```json
{
  "tool": "crm",
  "action": "remove_from_group",
  "contact_id": 2,
  "group_name": "Newsletter"
}
```

Returns:
```
✅ Removed Sarah Johnson from group "Newsletter"
```

## Natural Language Examples

The CRM tool works naturally in conversation:

- "Who do I know at Acme?"
- "What did I last talk to John about?"
- "Add Alice Brown as a new contact, she works at Microsoft"
- "Log a meeting with Sarah: discussed product demo, very interested"
- "Who has a birthday coming up soon?"
- "Tag John as an enterprise customer"
- "Show me all companies in the tech industry"
- "John and Jane are married"
- "Add everyone from TechStartup to the Beta Testers group"
- "What groups is John in?"
- "Remove the test contact"

The agent will map these to the appropriate CRM tool actions.
