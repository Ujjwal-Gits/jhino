# Build for Jhino

Give this to Claude or any AI coding tool together with your app. The same text is in the dashboard under Details → Copy build instructions. (Or skip coding entirely: use **Create HTML** in Jhino.)

```text
Build (or adapt) this app to run inside Jhino, a self-hosted home for small web apps.

Package
- One index.html file, or a .zip with index.html at the top plus its css/js/images.
- Browser code only (HTML, CSS, JavaScript). No server code, no build step on the server.
- Prefer bundling libraries inside the file or zip. CDN scripts work but need internet access.

Saving data (pick one)
1. Simple: keep all shared data in localStorage as JSON. Jhino saves every localStorage
   key on its server and syncs it live to everyone who has the app.
   - Store lists as arrays of objects that each have a stable "id" field
     (for example crypto.randomUUID()). Jhino merges edits from different people by id.
   - Listen for changes so the screen updates without a reload:
       window.addEventListener('storage', () => { state = load(); render(); });
   - Keys meant for one person only (theme, last tab) can be marked private by the owner.
2. Records API (best for bigger apps): window.jhino is available automatically.
       await jhino.ready();
       const me = await jhino.me();                       // { id, name, email, role }
       const { items, next } = await jhino.data.list('tasks', { limit: 50, after });
       const task = await jhino.data.create('tasks', { title: 'Hello', done: false });
       await jhino.data.update('tasks', task.id, { done: true }, { expectedRevision: task.revision });
       await jhino.data.delete('tasks', task.id);
       const stop = await jhino.data.subscribe('tasks', (change) => refetch());
   Records: { id, data, revision, createdBy, createdAt, updatedBy, updatedAt }.
   Files (photos, PDFs, videos up to 2 GB):
       const f = await jhino.files.upload(file, { onProgress: ({ loaded, total }) => {} });
       // f = { id, name, type, size, url, downloadUrl }; store f.id in a record field
       img.src = jhino.files.url(f.id);   // videos stream and can seek
       await jhino.files.delete(f.id);
   People who can open the app: await jhino.people()  ->  [{ id, name, role }]
   Optional manifest (lets the server check every save):
       <script type="application/json" id="jhino-manifest">
       { "specVersion": 1, "collections": { "tasks": { "fields": {
         "title": { "type": "text", "required": true }, "done": { "type": "boolean" } } } } }
       </script>
   Field types: text, longtext, number, money (whole paisa/cents), boolean, date, time, datetime,
   select (with "options"), url, email, phone, user, file, files, json. "protected": true means
   only editors can change it; collection "visibility": "own" shows people only their own items.
   Errors have err.code: FORBIDDEN (viewer), VALIDATION_FAILED, REVISION_CONFLICT
   (err.current holds the latest record: show it, keep the user's draft), QUOTA_EXCEEDED,
   CONNECTION_LOST. Collection names: letters, numbers, - and _.

Rules
- Do not use IndexedDB, cookies or sessionStorage for data that must be shared.
- Viewers can read but not change shared data; show a friendly message on FORBIDDEN.
- Do not ask for passwords or call Jhino URLs directly; the page is sandboxed.
- Works in any modern browser, on phones and desktops.
```

Working examples are in `samples/`:

- `samples/team-tasks/` (zipped as `team-tasks.zip`): a plain localStorage app with file attachments. It works unchanged.
- `samples/studio-poll.html`: a Claude artifact-style app using `window.storage`, with shared and private values.
- `samples/shared-checklist.html`: an app built for Jhino with a manifest, the records API, revisions and live subscribe.
