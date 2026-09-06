/**
 * Encodes `assets/sounds-src/*.wav` (from `npm run sounds:synth`) into a
 * single Howler-2-ready sprite: `public/sounds/brogram.{json,webm,mp3}`.
 * webm is primary (better compression), mp3 is the fallback that actually
 * protects Safari before 18.4 — Howler picks whichever the browser can play.
 *
 * Requires `ffmpeg` on PATH (`audiosprite` shells out to it). Both sprite
 * outputs are committed to `public/sounds/` so a fork with no ffmpeg still
 * gets sound — the sound manager falls back to loading each source clip
 * under `assets/sounds-src/` individually if the sprite is ever missing at
 * build time, but that path is for local dev only: `assets/sounds-src/` is
 * git-ignored (T0.0), so a fresh clone must run `sounds:synth` first.
 *
 * Run: `npm run sounds:sprite` (node scripts/build-sound-sprite.mjs)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import audiosprite from 'audiosprite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC_DIR = path.join(ROOT, 'assets', 'sounds-src')
const OUT_DIR = path.join(ROOT, 'public', 'sounds')
const OUT_BASENAME = path.join(OUT_DIR, 'brogram')
const PUBLIC_URL_PREFIX = '/sounds/'
const MAX_BYTES = 120 * 1024
const EXPORT_FORMATS = ['webm', 'mp3']

function requireFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  } catch {
    console.error(
      'ffmpeg was not found on PATH. Install it (https://ffmpeg.org/) and re-run `npm run sounds:sprite`.\n' +
      'Until then, load the individual generated clips from assets/sounds-src/ instead of the sprite —\n' +
      'the sound manager falls back to that automatically when public/sounds/brogram.json is missing.',
    )
    process.exit(1)
  }
}

function checkBudget(ext) {
  const file = `${OUT_BASENAME}.${ext}`
  const { size } = statSync(file)
  if (size > MAX_BYTES) {
    throw new Error(`${path.relative(ROOT, file)} is ${size} bytes, over the ${MAX_BYTES}-byte budget.`)
  }
  console.log(`${path.basename(file)}: ${size} bytes`)
}

function run() {
  requireFfmpeg()

  if (!existsSync(SRC_DIR)) {
    console.error(`No source clips at ${path.relative(ROOT, SRC_DIR)}. Run \`npm run sounds:synth\` first.`)
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })

  audiosprite(
    [path.join(SRC_DIR, '*.wav')],
    {
      output: OUT_BASENAME,
      export: EXPORT_FORMATS.join(','),
      format: 'howler2',
      gap: 0.05,
      minlength: 0,
      ignorerounding: 1, // bypass whole-second placement — every clip here is under a second
      samplerate: 44100,
      channels: 1,
      bitrate: 64, // short mono UI blips at 64kbps stay well under the 120KB budget
    },
    (err, json) => {
      if (err) {
        console.error('audiosprite failed:', err.message)
        process.exit(1)
      }

      // audiosprite's own `path` option joins with the platform path separator
      // (backslashes on Windows), which is not a usable URL. Rewrite the
      // resource list ourselves instead: bare filenames under /sounds/.
      const manifest = { ...json, src: json.src.map((resource) => `${PUBLIC_URL_PREFIX}${path.basename(resource)}`) }
      writeFileSync(`${OUT_BASENAME}.json`, `${JSON.stringify(manifest, null, 2)}\n`)

      try {
        for (const ext of EXPORT_FORMATS) checkBudget(ext)
      } catch (budgetErr) {
        console.error(budgetErr.message)
        process.exit(1)
      }

      console.log(`\nSprite built: ${Object.keys(manifest.sprite).length} sounds, ${EXPORT_FORMATS.join(' + ')}.`)
    },
  )
}

run()
