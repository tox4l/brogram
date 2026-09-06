#!/usr/bin/env node
// Prepares the two self-hosted assets the browser Java runtime needs:
//
//  1. public/java/tools.jar - OpenJDK 8's compiler (com.sun.tools.javac.Main).
//     GPLv2 with the Classpath Exception, so it is NOT committed to this MIT
//     repository (see .gitignore and public/java/TOOLS-JAR-LICENSE.md). It is
//     extracted from Adoptium's official Temurin 8 JDK archive, pinned below by
//     URL and sha256. CheerpJ range-requests the jar, so only the compiler
//     classes javac actually touches ever cross the wire (~6 MB of the 18 MB).
//  2. public/java/*.wasm - the tree-sitter runtime and the Java grammar used by
//     src/lib/runtimes/java-structure.ts. Plain copies out of node_modules,
//     the same pattern as scripts/copy-sqljs-wasm.mjs.
//
// Idempotent: an already-correct tools.jar is left alone. Offline-safe: a
// failed download warns and exits 0 so `npm install` never breaks (the runtime
// reports a missing compiler at warmup instead).
import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { once } from 'node:events'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT_DIR = join(ROOT, 'public', 'java')
const TOOLS_JAR = join(OUT_DIR, 'tools.jar')

// Adoptium Temurin 8u504-b01, the exact build docs/research/cheerpj-spike.md used.
// The host platform is irrelevant: lib/tools.jar is pure bytecode. The Linux
// tarball is chosen because a tar stream can be parsed entry by entry without
// buffering the archive, which a zip's trailing central directory cannot.
const ARCHIVE_URL = 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u504-b01/OpenJDK8U-jdk_x64_linux_hotspot_8u504b01.tar.gz'
const ARCHIVE_SHA256 = '9c70e102f527ac674ac2fe9c7d47b9a04e2d19842ba5ab8e9b33f368bbadfaea'
const TOOLS_JAR_BYTES = 18_361_919
const TOOLS_JAR_SHA256 = 'f2599fc78dcbfadefc1cb6b79e05d281e090217ac0139d50b792d72bf1130af4'

const WASM_COPIES = [
  ['node_modules/web-tree-sitter/web-tree-sitter.wasm', 'web-tree-sitter.wasm'],
  ['node_modules/tree-sitter-java/tree-sitter-java.wasm', 'tree-sitter-java.wasm'],
]

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isValidToolsJar(path) {
  if (!existsSync(path) || statSync(path).size !== TOOLS_JAR_BYTES) return false
  return sha256(path) === TOOLS_JAR_SHA256
}

function copyWasm() {
  for (const [from, to] of WASM_COPIES) {
    const source = join(ROOT, from)
    if (!existsSync(source)) {
      console.warn(`prepare:java: ${from} is missing; skipping ${to}. Run npm install first.`)
      continue
    }
    copyFileSync(source, join(OUT_DIR, to))
    console.log(`prepare:java: ${to} copied`)
  }
}

/**
 * Streams a .tar.gz and writes the first entry whose path ends with `suffix`.
 * Entries are walked 512 bytes at a time and skipped without being buffered, so
 * peak memory stays at one chunk regardless of the 103 MB archive.
 */
async function extractFromTarGz(url, suffix, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${url} responded ${response.status}`)

  const stream = Readable.fromWeb(response.body).pipe(createGunzip())
  let pending = Buffer.alloc(0)
  let skip = 0
  let out = null
  let written = 0
  let size = 0

  try {
    for await (const chunk of stream) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      for (;;) {
        if (out) {
          const take = Math.min(pending.length, size - written)
          if (take) {
            out.write(pending.subarray(0, take))
            pending = pending.subarray(take)
            written += take
          }
          if (written < size) break
          const closed = once(out, 'close')
          out.end()
          out = null
          stream.destroy()
          await closed
          return written
        }
        if (skip) {
          const take = Math.min(pending.length, skip)
          pending = pending.subarray(take)
          skip -= take
          if (skip) break
          continue
        }
        if (pending.length < 512) break
        const header = pending.subarray(0, 512)
        pending = pending.subarray(512)
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*/s, '')
        if (!name) continue
        size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*/s, '').trim(), 8) || 0
        const padded = Math.ceil(size / 512) * 512
        if (header[156] === 0x30 /* '0' */ && name.endsWith(suffix)) {
          out = createWriteStream(destination)
          written = 0
        } else {
          skip = padded
        }
      }
    }
  } finally {
    if (out) out.end()
    stream.destroy()
  }
  throw new Error(`no entry ending in ${suffix} was found in ${url}`)
}

async function fetchToolsJar() {
  if (isValidToolsJar(TOOLS_JAR)) {
    console.log('prepare:java: tools.jar already present and verified')
    return
  }
  // The CheerpJ spike downloaded the same build; reuse it instead of pulling 103 MB again.
  const spikeJar = join(ROOT, 'public', 'spikes', 'cheerpj', 'tools.jar')
  if (isValidToolsJar(spikeJar)) {
    copyFileSync(spikeJar, TOOLS_JAR)
    console.log('prepare:java: tools.jar copied from the CheerpJ spike')
    return
  }

  const temporary = `${TOOLS_JAR}.download`
  console.log(`prepare:java: downloading ${ARCHIVE_URL} (103 MB, once; expected sha256 ${ARCHIVE_SHA256})`)
  try {
    await extractFromTarGz(ARCHIVE_URL, '/lib/tools.jar', temporary)
    const size = statSync(temporary).size
    if (size !== TOOLS_JAR_BYTES) throw new Error(`tools.jar is ${size} bytes, expected ${TOOLS_JAR_BYTES}`)
    const digest = sha256(temporary)
    if (digest !== TOOLS_JAR_SHA256) throw new Error(`tools.jar sha256 is ${digest}, expected ${TOOLS_JAR_SHA256}`)
    renameSync(temporary, TOOLS_JAR)
    console.log(`prepare:java: tools.jar written (${size} bytes, sha256 verified)`)
  } catch (error) {
    rmSync(temporary, { force: true })
    // Never fail an install. Java exercises report a missing compiler at warmup;
    // every other language is unaffected.
    console.warn(`prepare:java: could not prepare tools.jar (${error.message}). Java exercises stay unavailable until this succeeds; rerun with: npm run prepare:java`)
  }
}

mkdirSync(OUT_DIR, { recursive: true })
copyWasm()
await fetchToolsJar()
