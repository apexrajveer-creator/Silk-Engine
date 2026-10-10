# Silk Engine 0.7.0 — Discover

Discover is integrated below My wallpapers in the Library page. Its thumbnails open a liquid-glass window containing a large thumbnail, creator attribution, description, tags, resolution, format, size, Download and Download & Apply. Downloaded wallpapers become local collection entries; already-installed items show Downloaded and Apply. My wallpapers remains usable offline.

The included online integration uses a dedicated Supabase catalog, Auth and private Storage. Browse/search/filter/latest paging, signed assets, email-code accounts, submissions and reports are implemented. GIF, MP4 and WebM uploads are limited to 50 MB. Uploaded content remains private until an operator reviews and publishes it. No catalog sample is disguised as a live community.

Native downloads stream to an app-owned partial file, validate file size/type/SHA-256, sync and rename it, then transactionally add/apply the wallpaper. Only one native download runs at once. Cancellation is checked between chunks; network reads time out after 20 seconds, so an idle/stalled connection can take that long to release. Failed/cancelled downloads remove their partial files. A completed file can remain on disk if the final settings save fails; retrying installs it again. Browser previews also support verified downloads into their mock collection with a bounded 50 MB buffer.

The backend is not live yet. Follow `backend/SETUP.md`, run `backend/schema.sql` on your dedicated Supabase project and fill `src/community/config.json` with the project URL/public key. Users can then use the same shared service in installed copies. Never include a service-role/secret key. No external project has been provisioned, deployed or changed during this work.

36 JavaScript regression tests passed, including community configuration rejection, media signatures/paths, encoded published-only catalog requests, signed URL confinement, minimal responses, failed-upload cleanup and UI wiring. Existing wallpaper/widget tests pass. Native download tests are included but not run; the SQL and Windows UI/native build remain unverified here. The setup guide lists the live access-control and two-device acceptance tests required before public distribution.

No automatic content/rights/antivirus moderation is claimed. Supabase storage/egress, SMTP, signup abuse controls, operator review and cleanup are deployment responsibilities. Anonymous downloads use short-lived signed URLs; access revocation can take until those expire.

To build: quit Silk from the tray, replace the source, run npm install, npm test, npm run dev. Run npm run build on Windows for installers. This corrected source ZIP omits the invalid Cargo.lock from the original 0.7.0 package. Cargo generates a new lockfile from available registry versions on first run. For an existing extracted folder, run repair-dependencies.cmd first. Native dependency resolution and Windows compilation have not been verified in this environment; this is a packaging correction, not a verified Windows release.


## UI packaging correction

The original 0.7.0 stylesheet was accidentally replaced with JavaScript, causing a white, unstyled Studio. The UI fix restores src/studio/studio.css byte-for-byte from 0.6.2 and puts Discover styles in a separate src/community/community.css, linked by index.html. A regression test now rejects JavaScript in linked stylesheets and checks the essential Studio layout rules.

To repair an already-building 0.7.0 installation: quit Silk from the tray, replace only the src folder from this ZIP, then run npm run dev. Keep your locally generated src-tauri/Cargo.lock. Windows runtime visual verification remains outstanding.
