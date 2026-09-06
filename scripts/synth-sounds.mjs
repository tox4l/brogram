/**
 * Generates every BroGram UI/reward sound procedurally — pure Node, no
 * dependency, no network (§3 C5) — as mono 44.1kHz 16-bit PCM WAV files
 * under `assets/sounds-src/` (git-ignored; see .gitignore). Every clip is
 * additive synthesis (sine partials) or filtered noise with an exponential
 * decay envelope. All BroGram-authored, therefore CC0 (public/sounds/CREDITS.md).
 *
 * Deterministic: nothing here reads `Math.random()`. The one clip that uses
 * noise (`hint`, `submit.send`, `fail`, `streak.light`) is generated from a
 * tiny seeded PRNG keyed by the sound's own id, so re-running this script
 * with no source changes produces byte-identical WAV files and never
 * churns `scripts/build-sound-sprite.mjs`'s output.
 *
 * Run: `npm run sounds:synth` (node scripts/synth-sounds.mjs)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 44100
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = path.join(ROOT, 'assets', 'sounds-src')

// --- deterministic PRNG (mulberry32, seeded by an FNV-1a hash of the clip id) ---

function seedFromString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- synthesis primitives ---

function silence(ms) {
  return new Float32Array(Math.max(0, Math.round((SAMPLE_RATE * ms) / 1000)))
}

/** A sine partial with linear attack, exponential decay, and an optional pitch sweep. */
function tone({ freq, freqEnd = null, ms, gain = 0.5, decay = 6, attackMs = 3 }) {
  const n = Math.max(1, Math.round((SAMPLE_RATE * ms) / 1000))
  const out = new Float32Array(n)
  const attackN = Math.max(1, Math.round((SAMPLE_RATE * attackMs) / 1000))
  let phase = 0
  for (let i = 0; i < n; i++) {
    const tn = i / n
    const f = freqEnd == null ? freq : freq + (freqEnd - freq) * tn
    phase += (2 * Math.PI * f) / SAMPLE_RATE
    const attackEnv = i < attackN ? i / attackN : 1
    const decayEnv = Math.exp(-decay * tn)
    out[i] = Math.sin(phase) * gain * attackEnv * decayEnv
  }
  return out
}

/** `tone` plus a quiet octave overtone, for a warmer, less thin sine. */
function warmTone(opts) {
  return mix(tone(opts), tone({ ...opts, freq: opts.freq * 2, freqEnd: opts.freqEnd == null ? null : opts.freqEnd * 2, gain: opts.gain * 0.22 }))
}

/** Seeded noise, one-pole low-passed into a soft whoosh/thud rather than static, with exponential decay. */
function noise({ ms, gain = 0.3, decay = 6, seed, smooth = 0.15 }) {
  const n = Math.max(1, Math.round((SAMPLE_RATE * ms) / 1000))
  const rand = mulberry32(seedFromString(seed))
  const out = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const raw = rand() * 2 - 1
    prev += smooth * (raw - prev)
    const tn = i / n
    const decayEnv = Math.exp(-decay * tn)
    out[i] = prev * gain * decayEnv
  }
  return out
}

function mix(...layers) {
  const len = Math.max(...layers.map((l) => l.length))
  const out = new Float32Array(len)
  for (const layer of layers) for (let i = 0; i < layer.length; i++) out[i] += layer[i]
  return out
}

function concat(...parts) {
  const len = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Float32Array(len)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

/** Sequential notes, each starting `stepMs` after the previous (so they can overlap/legato). */
function sequence(notes, stepMs) {
  const stepN = Math.round((SAMPLE_RATE * stepMs) / 1000)
  const total = notes.reduce((max, note, i) => Math.max(max, i * stepN + note.length), 0)
  const out = new Float32Array(total)
  notes.forEach((note, i) => {
    const offset = i * stepN
    for (let j = 0; j < note.length; j++) out[offset + j] += note[j]
  })
  return out
}

function normalize(samples, peak = 0.9) {
  let max = 0
  for (const s of samples) max = Math.max(max, Math.abs(s))
  if (max === 0 || max <= peak) return samples
  const scale = peak / max
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * scale
  return out
}

// --- musical constants (equal temperament, A4 = 440Hz) ---

const C5 = 523.25
const D5 = 587.33
const E5 = 659.25
const F5 = 698.46
const G5 = 783.99
const A5 = 880.0
const B5 = 987.77
const C6 = 1046.5
const D6 = 1174.66
const E6 = 1318.51
const G6 = 1567.98
const C7 = 2093.0

// --- per-event clip design ---
// Every id's character note is a direct callout to the T0.5 brief so review
// can check sound design against intent, not just byte output.

const CLIPS = {
  // Interface tier (quiet, off by default) -----------------------------------

  /** Smallest, quietest tick in the set — a bare keypress/click affordance. */
  'ui.tap': () => tone({ freq: 1200, ms: 60, gain: 0.22, decay: 14, attackMs: 1 }),

  /** Quiet neutral click, a notch warmer/longer than ui.tap — "run" is lower-key than "submit". */
  'run.go': () => warmTone({ freq: 700, ms: 90, gain: 0.28, decay: 10, attackMs: 2 }),

  /** Soft whoosh, anticipation only — no result yet, so no melodic content. */
  'submit.send': () => mix(
    noise({ ms: 160, gain: 0.22, decay: 5, seed: 'submit.send', smooth: 0.35 }),
    tone({ freq: 320, freqEnd: 560, ms: 160, gain: 0.12, decay: 5, attackMs: 20 }),
  ),

  /** A page turn — deliberately unexciting: pure filtered noise, no tone. */
  hint: () => noise({ ms: 150, gain: 0.16, decay: 5, seed: 'hint', smooth: 0.08 }),

  /** Quick, light, positive — lower stakes than a full exercise pass. */
  'drill.hit': () => tone({ freq: 880, ms: 90, gain: 0.32, decay: 11, attackMs: 2 }),

  /** Quick and neutral, never harsh — a miss is information, not a scolding. */
  'drill.miss': () => tone({ freq: 300, freqEnd: 260, ms: 100, gain: 0.26, decay: 9, attackMs: 2 }),

  /** The most conservative sound in the whole set — a notification, not a reward. */
  'wellness.chime': () => tone({ freq: 660, ms: 220, gain: 0.16, decay: 4, attackMs: 30 }),

  // Reward tier (default on, killed only by the header mute) ------------------

  /** A warm two-note rise. */
  pass: () => normalize(sequence([
    warmTone({ freq: C5, ms: 110, gain: 0.4, decay: 7, attackMs: 3 }),
    warmTone({ freq: E5, ms: 150, gain: 0.42, decay: 6, attackMs: 3 }),
  ], 90)),

  /** A soft low thud — never a buzzer. */
  fail: () => normalize(mix(
    tone({ freq: 130, freqEnd: 100, ms: 200, gain: 0.34, decay: 8, attackMs: 4 }),
    noise({ ms: 90, gain: 0.14, decay: 10, seed: 'fail', smooth: 0.5 }),
  )),

  /** A short ascending blip, clearly distinct from `pass` (a sweep, not two discrete notes). */
  'chain.tick': () => tone({ freq: 420, freqEnd: 920, ms: 90, gain: 0.36, decay: 9, attackMs: 2 }),

  /** The biggest sound short of `first.win` — a rich ascending chord. */
  'clo.close': () => normalize(sequence([
    warmTone({ freq: C5, ms: 220, gain: 0.34, decay: 5, attackMs: 3 }),
    warmTone({ freq: E5, ms: 220, gain: 0.34, decay: 5, attackMs: 3 }),
    warmTone({ freq: G5, ms: 260, gain: 0.4, decay: 4, attackMs: 3 }),
  ], 90)),

  /** Layered arpeggio, the single biggest sound in the set — once per account, permanently. */
  'first.win': () => normalize(mix(
    sequence([
      warmTone({ freq: C5, ms: 260, gain: 0.32, decay: 4, attackMs: 4 }),
      warmTone({ freq: E5, ms: 260, gain: 0.34, decay: 4, attackMs: 4 }),
      warmTone({ freq: G5, ms: 300, gain: 0.36, decay: 3.6, attackMs: 4 }),
      warmTone({ freq: C6, ms: 340, gain: 0.4, decay: 3.2, attackMs: 4 }),
      warmTone({ freq: E6, ms: 420, gain: 0.42, decay: 2.6, attackMs: 4 }),
    ], 110),
    tone({ freq: C5 / 2, ms: 900, gain: 0.1, decay: 2.4, attackMs: 30 }),
  )),

  /** Layered arpeggio, a notch below `first.win` — rare, so a bigger budget than a routine pass. */
  'level.up': () => normalize(mix(
    sequence([
      warmTone({ freq: C5, ms: 220, gain: 0.32, decay: 4.4, attackMs: 3 }),
      warmTone({ freq: F5, ms: 240, gain: 0.34, decay: 4, attackMs: 3 }),
      warmTone({ freq: A5, ms: 260, gain: 0.36, decay: 3.6, attackMs: 3 }),
      warmTone({ freq: C6, ms: 340, gain: 0.4, decay: 3, attackMs: 3 }),
    ], 100),
    tone({ freq: F5 / 2, ms: 750, gain: 0.09, decay: 2.6, attackMs: 25 }),
  )),

  /** One very quiet tick on the settled value — never per-frame. */
  'xp.settle': () => tone({ freq: 900, ms: 70, gain: 0.18, decay: 16, attackMs: 1 }),

  /** Flame ignite: a whoosh under a rising tone. */
  'streak.light': () => normalize(mix(
    noise({ ms: 320, gain: 0.2, decay: 4.5, seed: 'streak.light', smooth: 0.3 }),
    tone({ freq: 220, freqEnd: 520, ms: 300, gain: 0.3, decay: 4, attackMs: 15 }),
  )),

  /** A distinct multi-note flourish, used nowhere else, so it keeps its meaning. */
  'streak.milestone': () => normalize(sequence([
    warmTone({ freq: G5, ms: 110, gain: 0.3, decay: 8, attackMs: 2 }),
    warmTone({ freq: B5, ms: 110, gain: 0.3, decay: 8, attackMs: 2 }),
    warmTone({ freq: D6, ms: 130, gain: 0.32, decay: 7, attackMs: 2 }),
    warmTone({ freq: G6, ms: 320, gain: 0.4, decay: 3.4, attackMs: 3 }),
  ], 70)),

  /** Somber, low, optional-mute — reassurance, not punishment. Never louder than `pass`. */
  'streak.lost': () => normalize(mix(
    tone({ freq: 300, freqEnd: 150, ms: 320, gain: 0.22, decay: 4, attackMs: 15 }),
    tone({ freq: 296, freqEnd: 148, ms: 320, gain: 0.14, decay: 4, attackMs: 15 }), // slight detune for a somber beat
  )),

  /** A new personal best — a bright, short sparkle. */
  best: () => normalize(sequence([
    tone({ freq: E6, ms: 90, gain: 0.26, decay: 12, attackMs: 1 }),
    tone({ freq: G6, ms: 90, gain: 0.26, decay: 12, attackMs: 1 }),
    warmTone({ freq: C7, ms: 160, gain: 0.3, decay: 8, attackMs: 1 }),
  ], 55)),

  /** Daily goal complete — a satisfied, gentle chime. */
  'goal.done': () => normalize(sequence([
    warmTone({ freq: E5, ms: 150, gain: 0.32, decay: 6, attackMs: 4 }),
    warmTone({ freq: A5, ms: 220, gain: 0.34, decay: 5, attackMs: 4 }),
  ], 90)),
}

export const SOUND_EVENT_IDS = Object.keys(CLIPS)

// --- WAV encoding ---

function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate (mono, 16-bit)
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  return buffer
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const id of SOUND_EVENT_IDS) {
    const samples = normalize(CLIPS[id](), 0.92)
    const wav = encodeWav(samples)
    writeFileSync(path.join(OUT_DIR, `${id}.wav`), wav)
    console.log(`${id}.wav: ${(samples.length / SAMPLE_RATE * 1000).toFixed(0)}ms, ${wav.length} bytes`)
  }
  console.log(`\n${SOUND_EVENT_IDS.length} clips written to ${path.relative(ROOT, OUT_DIR)}`)
}

main()
