# Connect the online Discover service

The app implementation and database schema are included. No Supabase project has been created or changed by this update. The shipped config is empty; Discover explicitly displays that it is awaiting connection rather than showing fake wallpapers.

## 1. Create a dedicated project

Create a Supabase project for Silk Discover at https://supabase.com/dashboard . Use a dedicated project rather than sharing the Logbook database. Choose the plan and region yourself; check storage/egress quotas for your expected video traffic.

In SQL Editor, run the entire `backend/schema.sql` once. It creates the catalog, submission workflow, quota trigger, reports and private `silk-wallpapers` bucket. The migration intentionally fails rather than overwriting an existing deployment; keep this file as the initial schema version.

## 2. Configure email sign-in

Enable the Email provider. The app uses email codes, not a browser redirect. In Authentication → Email Templates, ensure the sign-in and confirmation messages display `{{ .Token }}`. Configure your production SMTP provider, sender and appropriate email/auth rate limits. Keep CAPTCHA off for the first connection test; enabling it requires adding a CAPTCHA integration to the client first. Never weaken database/storage policies to fix sign-in errors.

Sessions remain in Studio memory and refresh while Studio is open. Closing Studio requires signing in again for uploads. Anonymous catalog browsing and downloads remain available.

## 3. Connect the app

From the project's API settings, copy its HTTPS project URL and **publishable key** (or legacy **anon key**). Put them in `src/community/config.json`:

```json
{
  "url": "https://YOUR_PROJECT_REF.supabase.co",
  "publicKey": "YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY"
}
```

Never put a `service_role` or `sb_secret_` key in the app. The client rejects recognized secret keys. The native downloader and CSP currently support hosted `*.supabase.co` project URLs; custom domains/self-hosted projects require a separate allowlist configuration change.

Run `npm install`, `npm test` and `npm run dev` on Windows. Discover appears below My wallpapers. No separate application server or Edge Function is needed for this initial service: database RLS, Auth and Storage handle the online operations.

## 4. Seed and review the first wallpaper

Sign in inside Discover. Upload a GIF, MP4 or WebM you have permission to share, with a title and creator credit. The app generates a WebP thumbnail and submits the metadata/assets for review. Files are capped at 50 MB; declared submissions at 20 / 200 MB per account. Thumbnails must be at most 1 MB on submission. Owners can delete incomplete drafts from their account window.

In SQL Editor:

```sql
select id,title,creator,extension,bytes,media_path,thumbnail_path,status
from public.community_wallpapers
where status='pending' order by created_at;
```

Use the private bucket's dashboard to inspect the actual file and thumbnail. Check decodeability, dimensions, declared size, checksum and permission to redistribute. There is no automated antivirus/content/rights review. Publish only reviewed submissions:

```sql
update public.community_wallpapers
set status='published'
where id='THE_REVIEWED_UUID' and status='pending';
```

Rejected submissions:

```sql
update public.community_wallpapers set status='rejected' where id='THE_UUID';
```

To remove a published item from the catalog, set it to `rejected`. Previously issued signed URLs remain usable until their expiry (normally ten minutes). For immediate asset removal, delete the objects too. Do not delete pending/rejected metadata before deleting its stored objects or orphan assets will remain.

Review `community_reports` in the dashboard. A signed-in account may submit one report per wallpaper. Add your moderation staffing, abuse monitoring and retention process before inviting the public. Clean old drafts and rejected submissions regularly, deleting their objects before their rows. Quotas limit declared submissions; bucket limits constrain individual stored objects. Auth/signup rate limits are still necessary to resist account farming.

## 5. Verify the live deployment

Test with two accounts and an anonymous session:

- Anonymous viewers see only published records and can sign/read only approved assets.
- One account cannot read another's draft or change another's rows/objects.
- A creator cannot mark their own submission published through the API, update approved objects, or exceed submission quotas.
- Upload → pending → review → published → refresh works on a second device.
- Download and Download & Apply create local My wallpapers entries; applied wallpapers play normally after restart.
- Cancel/retry, offline failure, storage-full/disk-full, stale signed URLs, wrong hashes, sign-out and token refresh work.
- Build the Windows installer and run the native Rust tests/Clippy before release.

The schema has been executed successfully in a local PostgreSQL-compatible PGlite instance with mock auth/storage tables. A valid submission becomes pending; missing MIME metadata is rejected. Supabase integration, real Storage metadata and live access-control tests still require your configured project. See UPDATE-0.8.0.md for native and frontend checks.

Primary references:
https://supabase.com/docs/guides/storage/security/access-control
https://supabase.com/docs/guides/auth/auth-email-passwordless
https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl
