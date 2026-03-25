# Create a Google Classroom Course

Create a course and invite students.

> [!NOTE]
> Classroom is not enabled by default. You must enable the Google Classroom API in your GCP project and authenticate with `gws auth login --full` to include the required scopes.

## Steps

1. Create the course: `gws classroom courses create --json '{"name": "Introduction to CS", "section": "Period 1", "room": "Room 101", "ownerId": "me"}'`
2. Invite a student: `gws classroom invitations create --json '{"courseId": "COURSE_ID", "userId": "student@school.edu", "role": "STUDENT"}'`
3. List enrolled students: `gws classroom courses students list --params '{"courseId": "COURSE_ID"}' --format table`
