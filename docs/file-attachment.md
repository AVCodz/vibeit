# File Attachment (Image Support)

Image attachments let users include visual references (screenshots, wireframes, logos, mockups) alongside text prompts. The AI agent (OpenCode + Fireworks AI Kimi K2.5) processes these images as context when generating code.

## Architecture

```
User attaches image(s) in chat input
         |
         v
Client uploads to POST /api/projects/:id/attachments/upload
         |
         v
Server validates (type, size) -> stores in R2 -> inserts DB row
         |
         v
Returns { attachmentId, publicUrl, filename }
         |
         v
Client shows thumbnail preview with filename (removable)
         |
         v
On Send: attachmentIds[] sent to /runs/stream alongside prompt
         |
         v
Server resolves URLs, links attachments to user message,
prepends image context to prompt:
  "The user attached these reference images..."
  - image.png: https://cdn.example.com/.../image.png
         |
         v
OpenCode + Kimi K2.5 processes images via URL
```

## Database

### `message_attachments` table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| project_id | UUID | FK to projects, CASCADE on delete |
| message_id | UUID | FK to project_messages, nullable (linked after message creation) |
| filename | TEXT | Original filename |
| content_type | TEXT | MIME type (image/png, image/jpeg, etc.) |
| size_bytes | BIGINT | File size in bytes |
| r2_key | TEXT | Full R2 storage key |
| public_url | TEXT | Public CDN URL |
| created_at | TIMESTAMPTZ | Upload timestamp |

### Migration SQL

```sql
CREATE TABLE message_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id UUID REFERENCES project_messages(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

## R2 Storage

Images are stored at:
```
{r2Prefix}/attachments/{attachmentId}/{sanitized-filename}
```

Example:
```
projects/user123/req-abc/attachments/550e8400.../screenshot.png
```

Public URL served via `R2_PUBLIC_BASE_URL` CDN.

## API Endpoints

### `POST /api/projects/:projectId/attachments/upload`

Upload a single image file.

**Request:** `multipart/form-data` with `file` field

**Validation:**
- Allowed types: png, jpg, jpeg, gif, webp, bmp, tiff
- Max size: 5MB per file (Fireworks AI URL limit)

**Response:**
```json
{
  "attachmentId": "uuid",
  "filename": "screenshot.png",
  "contentType": "image/png",
  "sizeBytes": 245000,
  "publicUrl": "https://cdn.example.com/projects/.../screenshot.png"
}
```

### `POST /api/projects/:projectId/runs/stream` (updated)

New optional field in request body:
```json
{
  "prompt": "Build a landing page like this",
  "attachmentIds": ["uuid-1", "uuid-2"]
}
```

The server:
1. Looks up attachment URLs from the database
2. Links attachments to the user message (`UPDATE message_attachments SET message_id = ...`)
3. Prepends image context to the prompt before sending to OpenCode

### `GET /api/projects/:projectId/messages` (updated)

Each message now includes its attachments:
```json
{
  "messages": [
    {
      "id": "msg-uuid",
      "role": "user",
      "content": "Build this",
      "attachments": [
        {
          "id": "att-uuid",
          "filename": "mockup.png",
          "contentType": "image/png",
          "sizeBytes": 245000,
          "publicUrl": "https://cdn.example.com/.../mockup.png"
        }
      ]
    }
  ]
}
```

## Client-Side Flow

### Project Page (`/projects/:id`)

1. Paperclip button opens hidden `<input type="file" multiple accept="image/*">`
2. Selected images appear as thumbnail cards above the textarea
   - Rounded thumbnail with filename below (truncated)
   - X button in top-right on hover to remove
   - Spinner overlay while uploading
3. On Send: uploads all pending images -> collects attachmentIds -> sends with prompt
4. User message bubbles show attached image thumbnails inline

### Landing Page (`/`)

1. Same paperclip + file picker + thumbnail preview UI
2. On Send: bootstrap project first -> upload images to new project -> navigate with `?attachments=id1,id2`
3. Project page reads `attachments` URL param and passes IDs to the first auto-start run

## Fireworks AI Constraints

| Limit | Value |
|-------|-------|
| Max images per request | 30 |
| Max URL image size | 5MB |
| Max base64 total | 10MB |
| URL download timeout | 1.5 seconds |
| Supported formats | png, jpg, jpeg, gif, bmp, tiff, ppm, webp |

Since we use R2 public CDN URLs, the 1.5s download timeout is not a concern.

## Files Changed

| File | Change |
|------|--------|
| `src/db/schema.ts` | Added `messageAttachments` table definition |
| `src/lib/r2.ts` | Added `uploadMessageAttachment()`, `isAllowedImageType()`, `isWithinAttachmentSizeLimit()` |
| `src/app/api/projects/[projectId]/attachments/upload/route.ts` | New upload endpoint |
| `src/app/api/projects/[projectId]/messages/route.ts` | Returns attachments per message |
| `src/app/api/projects/[projectId]/runs/stream/route.ts` | Accepts attachmentIds, prepends image URLs to prompt |
| `src/app/projects/[projectId]/page.tsx` | Attachment UI, upload flow, message rendering |
| `src/app/(main)/page.tsx` | Landing page attachment UI, upload-after-bootstrap flow |
| `database-schema.md` | Added message_attachments, project_messages, project_env_vars tables |
