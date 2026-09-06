import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DEFAULT_PROJECT_REF = 'kpxqsathxgynzqyuoqaz'

const SITE_URL = 'https://brogram-nine.vercel.app'
const REDIRECT_URLS = [
  'https://brogram-nine.vercel.app/auth/confirm',
  'https://brogram-nine.vercel.app/**',
  'http://127.0.0.1:3000/auth/confirm',
]
const MAGIC_LINK_SUBJECT = 'Your BroGram sign-in link'
const CONFIRMATION_SUBJECT = 'Confirm your BroGram account'

async function accessToken(root, env) {
  let local = {}
  try {
    local = parseEnv(await readFile(join(root, '.env.local'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const token = env.SUPABASE_ACCESS_TOKEN?.trim() || local.SUPABASE_ACCESS_TOKEN?.trim()
  if (!token) throw new Error('Missing SUPABASE_ACCESS_TOKEN. Set it in .env.local or the environment.')
  return token
}

export async function buildConfig(root = ROOT) {
  const templates = join(root, 'supabase', 'templates')
  const [magicLink, confirmSignup] = await Promise.all([
    readFile(join(templates, 'magic-link.html'), 'utf8'),
    readFile(join(templates, 'confirm-signup.html'), 'utf8'),
  ])
  return {
    site_url: SITE_URL,
    uri_allow_list: REDIRECT_URLS.join(','),
    mailer_subjects_magic_link: MAGIC_LINK_SUBJECT,
    mailer_templates_magic_link_content: magicLink,
    mailer_subjects_confirmation: CONFIRMATION_SUBJECT,
    mailer_templates_confirmation_content: confirmSignup,
    hook_before_user_created_enabled: true,
    hook_before_user_created_uri: 'pg-functions://postgres/public/hook_gate_signup',
    mailer_otp_exp: 3600,
  }
}

export async function applyAuthConfig({ root = ROOT, env = process.env, projectRef } = {}) {
  const ref = projectRef || env.SUPABASE_PROJECT_REF?.trim() || DEFAULT_PROJECT_REF
  const token = await accessToken(root, env)
  const body = await buildConfig(root)
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let responseBody
  try {
    responseBody = await response.text()
  } catch {
    responseBody = ''
  }
  return { status: response.status, ok: response.ok, body: responseBody }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await applyAuthConfig()
    console.log(`Supabase auth config PATCH: ${result.status}${result.ok ? ' OK' : ' FAILED'}`)
    if (!result.ok) {
      console.error(result.body)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`Supabase auth config update failed: ${error.message}`)
    process.exitCode = 1
  }
}
