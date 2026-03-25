# drive (v3)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws drive <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+upload` | Upload a file with automatic metadata — see [gws-drive-upload.md](gws-drive-upload.md) |

## API Resources

### about
- `get` — Gets information about the user, the user's Drive, and system capabilities. Required: The `fields` parameter must be set.

### accessproposals
- `get` — Retrieves an access proposal by ID.
- `list` — List the access proposals on a file. Only approvers can list.
- `resolve` — Approves or denies an access proposal.

### apps
- `get` — Gets a specific app.
- `list` — Lists a user's installed apps.

### changes
- `getStartPageToken` — Gets the starting pageToken for listing future changes.
- `list` — Lists the changes for a user or shared drive.
- `watch` — Subscribes to changes for a user.

### channels
- `stop` — Stops watching resources through this channel.

### comments
- `create` — Creates a comment on a file. Required: `fields` parameter.
- `delete` — Deletes a comment.
- `get` — Gets a comment by ID. Required: `fields` parameter.
- `list` — Lists a file's comments. Required: `fields` parameter.
- `update` — Updates a comment with patch semantics. Required: `fields` parameter.

### drives
- `create` — Creates a shared drive.
- `get` — Gets a shared drive's metadata by ID.
- `hide` — Hides a shared drive from the default view.
- `list` — Lists the user's shared drives. Accepts `q` search parameter.
- `unhide` — Restores a shared drive to the default view.
- `update` — Updates the metadata for a shared drive.

### files
- `copy` — Creates a copy of a file with patch semantics.
- `create` — Creates a file. Max size: 5,120 GB.
- `download` — Downloads the content of a file. Valid for 24 hours.
- `export` — Exports a Google Workspace document to requested MIME type. Max 10 MB.
- `generateIds` — Generates a set of file IDs for create/copy requests.
- `get` — Gets a file's metadata or content by ID. Use `alt=media` for content.
- `list` — Lists the user's files. Accepts `q` search. Returns all files including trashed by default.
- `listLabels` — Lists the labels on a file.
- `modifyLabels` — Modifies the set of labels applied to a file.
- `update` — Updates a file's metadata, content, or both. Supports patch semantics.
- `watch` — Subscribes to changes to a file.

### operations
- `get` — Gets the latest state of a long-running operation.

### permissions
- `create` — Creates a permission for a file or shared drive.
- `delete` — Deletes a permission.
- `get` — Gets a permission by ID.
- `list` — Lists a file's or shared drive's permissions.
- `update` — Updates a permission with patch semantics.

### replies
- `create` — Creates a reply to a comment.
- `delete` — Deletes a reply.
- `get` — Gets a reply by ID.
- `list` — Lists a comment's replies.
- `update` — Updates a reply with patch semantics.

### revisions
- `delete` — Permanently deletes a file version. Only for binary content.
- `get` — Gets a revision's metadata or content by ID.
- `list` — Lists a file's revisions.
- `update` — Updates a revision with patch semantics.

## Discovering Commands

```bash
gws drive --help
gws schema drive.<resource>.<method>
```
