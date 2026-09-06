# Supabase auth setup (BroGram)

Project ref: `kpxqsathxgynzqyuoqaz`. Production URL: `https://brogram-nine.vercel.app`. Local: `http://127.0.0.1:3000`.

Do these in order, in the Supabase Dashboard for this project.

## a) Authentication -> URL Configuration

- **Site URL**: `https://brogram-nine.vercel.app`
- **Redirect URLs** (add all three):
  - `https://brogram-nine.vercel.app/auth/confirm`
  - `https://brogram-nine.vercel.app/**`
  - `http://127.0.0.1:3000/auth/confirm`

The app's confirm route only accepts `token_hash` + `type=email` (see `src/app/auth/confirm/route.ts`); it does not use `{{ .ConfirmationURL }}`'s PKCE `code` flow, so no `code`-based callback route is needed.

## b) Authentication -> Email Templates

- **Magic Link** template: paste the contents of `supabase/templates/magic-link.html` into the HTML body, and set the subject to **Your BroGram sign-in link**.
- **Confirm signup** template: paste the contents of `supabase/templates/confirm-signup.html` into the HTML body, and set the subject to **Confirm your BroGram account**.
- Subjects are also listed in `supabase/templates/subjects.md`.
- Both templates link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. Do not switch either template back to `{{ .ConfirmationURL }}`.
- With `signInWithOtp({ shouldCreateUser: true })`: a brand-new email gets the **Confirm signup** template; a returning user gets the **Magic Link** template. That is why both need to be branded.

## c) Authentication -> Hooks -> Before User Created

- Enable the hook.
- Postgres function: `public.hook_gate_signup` (schema `public`).
- This function already exists via `supabase/migrations/0002_auth_hook.sql`. Registering it here is what actually turns the gate on — until it's registered, any `.edu.qa`-or-not email can sign up.

## d) Authentication -> Providers -> Email

- Keep **Confirm email** ON (new users must verify before they get a session).
- Set **OTP expiry** to `3600` seconds (1 hour), matching the "expires in an hour" copy in the templates.
- The built-in Supabase mailer is rate-limited to roughly 2-4 emails per hour per project (Supabase does not publish an exact number; this is the commonly reported ballpark) and always sends from a Supabase address, not BroGram's. Do not launch on the built-in mailer.
- To send from a branded address, turn on **Custom SMTP** (same Providers -> Email screen) with a real sender, e.g. Resend. Dashboard fields to fill, with the underlying Management API field name in parentheses:
  - **Host** (`smtp_host`)
  - **Port number** (`smtp_port`)
  - **Username** (`smtp_user`)
  - **Password** (`smtp_pass`)
  - **Sender email** (`smtp_admin_email`) - e.g. `noreply@<your-verified-domain>`
  - **Sender name** (`smtp_sender_name`) - set to `BroGram`
  - There is no separate "enable SMTP" flag in the API; setting these fields (via dashboard save, or the PATCH below) is what turns custom SMTP on.

## e) After the first admin sign-in

Two separate things read "who is admin," and they need to be set separately:

1. **App-level admin gate** (`src/lib/admin/gate.ts`, every `/api/admin/*` route and the `(admin)` layout): reads `ADMIN_USER_IDS` from the environment, comma-separated. On Vercel:
   ```
   vercel env add ADMIN_USER_IDS production
   ```
   paste Musa's `auth.users.id` (uuid, from Dashboard -> Authentication -> Users after his first sign-in), then redeploy.

2. **DB-level integrity-escalation exemption** (`apply_integrity_escalation()` in `supabase/migrations/0003_integrity.sql`, extended in `0004_admin_users.sql`): the trigger checks `current_setting('app.admin_user_ids', true)` **or** membership in `public.admin_users`.
   - The originally intended path was:
     ```sql
     alter database postgres set app.admin_user_ids = '<uuid>';
     ```
   - **This is already known not to work on this project.** `0004_admin_users.sql` records that hosted Supabase denies both `alter database ... set app.admin_user_ids` and `alter role ... set app.admin_user_ids` with "permission denied to set parameter". The per-role fallback the task description gestures at is exactly this: instead of a database-level GUC, insert the admin into the `public.admin_users` table (service-role only, already created by `0004_admin_users.sql`):
     ```sql
     insert into public.admin_users (user_id) values ('<uuid>') on conflict (user_id) do nothing;
     ```
     Run this in the SQL Editor (or via a service-role client) after Musa's first sign-in. `current_setting('app.admin_user_ids', true)` is left in the function as a harmless no-op branch in case a future environment ever allows setting it.

Do both (1) and (2); they gate different things (page/API access vs. integrity-escalation exemption).

## Apply everything from the command line

`scripts/supabase-auth-config.mjs` applies (a), (b), (c), and (d)'s OTP expiry via one Management API call. It does not touch custom SMTP or step (e) (those need a sender account and a real uuid respectively, so they stay manual).

1. Get a personal access token at `https://supabase.com/dashboard/account/tokens` (starts with `sbp_`).
2. Put it in `.env.local` as `SUPABASE_ACCESS_TOKEN=sbp_...` (or export it in the shell for one run). The script never prints this value.
3. Run:
   ```
   node scripts/supabase-auth-config.mjs
   ```
   It reads both HTML templates and `subjects.md` from `supabase/templates/`, sends one `PATCH https://api.supabase.com/v1/projects/kpxqsathxgynzqyuoqaz/config/auth`, and prints only the HTTP response status (and the response body on failure, which does not contain the token).

### Request body the script sends

Every field name below was checked against the live Management API reference page (`https://supabase.com/docs/reference/api/v1-update-auth-service-config`) on 2026-09-06:

| Field | Value | Verified? |
| --- | --- | --- |
| `site_url` | `https://brogram-nine.vercel.app` | Yes |
| `uri_allow_list` | comma-separated string of the three redirect URLs | Yes (confirmed type `string`, not an array) |
| `mailer_subjects_magic_link` | `Your BroGram sign-in link` | Yes |
| `mailer_templates_magic_link_content` | contents of `magic-link.html` | Yes |
| `mailer_subjects_confirmation` | `Confirm your BroGram account` | Yes |
| `mailer_templates_confirmation_content` | contents of `confirm-signup.html` | Yes |
| `hook_before_user_created_enabled` | `true` | Yes |
| `hook_before_user_created_uri` | `pg-functions://postgres/public/hook_gate_signup` | Field name yes; the `pg-functions://` URI *format* comes from Supabase's Auth Hooks guide, not from this endpoint's own schema text, so treat the value's shape (not the field name) as carried over from the task brief rather than independently re-verified here |
| `mailer_otp_exp` | `3600` | Field name and `integer` type yes; that the unit is seconds is standard Supabase Auth knowledge, not spelled out in the schema description itself |

Not sent by the script (manual, per step d/e above) but also checked against the same page while there: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email`, `smtp_sender_name`, `smtp_max_frequency` all verified as real field names. `smtp_port`'s documented type came back as `string` in that fetch, which is worth a second look by hand in the dashboard before scripting it, since a numeric port is more typical of that kind of field. Also confirmed to exist (came up while checking the "Confirm email" toggle; not used by the script and not touched by this setup): `mailer_autoconfirm` (boolean; the inverse of "Confirm email" - leaving it alone keeps "Confirm email" ON) and `external_email_enabled`. Not checked at all: `hook_before_user_created_secrets`.
