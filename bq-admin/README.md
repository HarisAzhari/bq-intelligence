# BQ Admin

A separate React + TypeScript + Tailwind project. The Python backend serves its production build at `/admin/`, so it shares the secure login cookie with BQ Intelligence.

```sh
npm install
npm run build
```

Start the backend from the repository root after building:

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/admin/`. Its separate administrator login is at `/admin/login`; workspace users sign in at `/login.html`. For development, `npm run dev` runs Vite at port 5174 and proxies API requests to port 8000. The login shares that origin through the proxy. Use the backend URL to open the main drawing workspace.

## Accounts and budgets

- Email/password login uses Supabase Auth. There are no registration or social-login routes.
- Only locally provisioned accounts can access this app, even if someone signs up directly through Supabase. Disable public signups in the Supabase dashboard as an additional project setting.
- Projects belong to individual accounts. Lists, jobs, source files, chats, and all project API routes enforce ownership. New uploads belong to the signed-in account. The two existing projects were assigned to haris535@gmail.com.
- Admins create, suspend, remove, and change monthly USD budgets. Suspension revokes app sessions immediately. The current administrator cannot suspend or delete themselves.
- Each account has a dedicated OpenRouter key with `limit`, `limit_reset: monthly`, and BYOK usage included. Every paid provider request (including background generation and streaming) uses that account's key. The shared legacy key is never used as a fallback for signed-in users.
- Budget changes are applied to OpenRouter before local settings are committed. Provider errors block changes and unprovisioned accounts cannot make AI calls.
- Usage comes from OpenRouter's current monthly totals, rather than a browser counter. Calendar resets use UTC. Provider reporting can lag and provider-side in-flight billing behavior applies.
- `$0` blocks AI access. Existing cached results remain readable without a new charge.
- Supabase secrets, OpenRouter keys, and app session records stay on the backend. Sessions use random, hashed, 12-hour tokens and HttpOnly, SameSite=Strict cookies; HTTPS adds the Secure flag.
- Back up `data/accounts.sqlite3` with the project data. It contains the provisioning registry and provider keys; protect it as a secret. This is a single-workspace deployment, not a distributed database design.

Required root `.env` values:

```dotenv
SUPABASE_API_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
OPENROUTER_MANAGEMENT_KEY=...
```

The `/rest/v1` suffix in `SUPABASE_API_URL` is accepted. The management key must be an OpenRouter **management key**, not an inference key.

For a fresh installation, create the first administrator privately with:

```sh
.venv/bin/python -m backend.bootstrap_admin
```

Passwords are entered in the terminal without echoing. Existing installations should use the admin app. The original administrator was provisioned for `papacong@gmail.com` with a starting budget of $25/month, adjustable in member settings. Its generated password was saved in the ignored, owner-readable `data/admin-credentials.txt` file.

The login photograph is by [Andrey Larionov on Unsplash](https://unsplash.com/photos/C74ceoQJhLk). Fonts and the photo load from their respective external hosts.

Validation: `npm run build` and `.venv/bin/python -m unittest discover -s tests -q` from the repository root (Python command only).
