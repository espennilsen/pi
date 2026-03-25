# people (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws people <resource> <method> [flags]
```

## API Resources

### contactGroups
- `batchGet`, `create`, `delete`, `get`, `list`, `update` — Contact group management.
- `members` — Contact group member operations.

### otherContacts
- `copyOtherContactToMyContactsGroup` — Copies an "Other contact" to myContacts.
- `list` — List all other contacts.
- `search` — Search other contacts.

### people
- `batchCreateContacts`, `batchUpdateContacts` — Batch operations.
- `createContact` — Create a new contact.
- `deleteContactPhoto`, `updateContactPhoto` — Photo management.
- `get` — Get person info. Use `people/me` for authenticated user.
- `getBatchGet` — Get multiple people.
- `listDirectoryPeople` — List domain directory profiles.
- `searchContacts` — Search contacts.
- `searchDirectoryPeople` — Search domain directory.
- `updateContact` — Update a contact.
- `connections` — Operations on connections.

## Discovering Commands

```bash
gws people --help
gws schema people.<resource>.<method>
```
