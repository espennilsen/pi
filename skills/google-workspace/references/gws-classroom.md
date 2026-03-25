# classroom (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.
>
> Classroom is not enabled by default. Enable the Google Classroom API in your GCP project and authenticate with `gws auth login --full` to include the required scopes.

```bash
gws classroom <resource> <method> [flags]
```

## API Resources

### courses
- `create` — Creates a course. The user in `ownerId` becomes owner and teacher.
- `delete` — Deletes a course.
- `get` — Returns a course by ID.
- `getGradingPeriodSettings` — Returns grading period settings for a course.
- `list` — Lists courses the requesting user can view.
- `patch` — Updates one or more fields in a course.
- `update` — Replaces all fields in a course.
- `updateGradingPeriodSettings` — Updates grading period settings.
- `aliases` — Course alias operations.
- `announcements` — Course announcement operations.
- `courseWork` — Coursework (assignments, questions) operations.
- `courseWorkMaterials` — Course work material operations.
- `posts` — Course post operations.
- `studentGroups` — Student group operations.
- `students` — Student roster operations.
- `teachers` — Teacher roster operations.
- `topics` — Course topic operations.

### invitations
- `accept` — Accepts an invitation, adding the user to the course.
- `create` — Creates an invitation. One per user/course at a time.
- `delete` — Deletes an invitation.
- `get` — Returns an invitation by ID.
- `list` — Lists invitations. Requires `user_id` or `course_id`.

### registrations
- `create` — Creates a registration for Pub/Sub notifications.
- `delete` — Deletes a registration, stopping notifications.

### userProfiles
- `get` — Returns a user profile.
- `guardianInvitations` — Guardian invitation operations.
- `guardians` — Guardian operations.

## Discovering Commands

```bash
gws classroom --help
gws schema classroom.<resource>.<method>
```
