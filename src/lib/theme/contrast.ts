/**
 * Pure colour math for R8.3 (spec §8.3): every foreground/background pair a
 * theme ships must pass both a WCAG 2.2 ratio check and an APCA `Lc` check.
 * Nothing here touches the DOM or reads `globals.css` — that parsing lives
 * in `contrast.test.ts`, which is the actual gate. This file is deliberately
 * dependency-free (no `culori`/`colorjs.io`): four palettes and ~10 pairs is
 * a small, fixed amount of math, and a from-scratch implementation is easier
 * to audit line-for-line against the published formulas than a library
 * import would be.
 *
 * Conversion path: OKLCH -> OKLab -> linear sRGB -> gamma-encoded sRGB,
 * using the matrices from Björn Ottosson's OKLab reference (also the basis
 * for the CSS Color 4 spec's OKLab/OKLCH definitions).
 */

export interface ParsedOklch {
  l: number
  c: number
  h: number
  /** 0-1. Defaults to 1 (opaque) when the source string has no `/ alpha`. */
  alpha: number
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%)?\s*)?\)$/i

/** Parses `oklch(L C H)` or `oklch(L C H / A)` (A as `0.6` or `60%`). */
export function parseOklch(value: string): ParsedOklch {
  const trimmed = value.trim()
  const match = OKLCH_RE.exec(trimmed)
  if (!match) throw new Error(`contrast.ts: not an oklch() colour: "${value}"`)
  const [, lRaw, cRaw, hRaw, aRaw, aPercent] = match
  const l = Number(lRaw)
  const c = Number(cRaw)
  const h = Number(hRaw)
  let alpha = 1
  if (aRaw !== undefined) alpha = aPercent ? Number(aRaw) / 100 : Number(aRaw)
  return { l, c, h, alpha }
}

function srgbGammaEncode(linear: number): number {
  const sign = linear < 0 ? -1 : 1
  const abs = Math.abs(linear)
  const encoded = abs <= 0.0031308 ? abs * 12.92 : 1.055 * abs ** (1 / 2.4) - 0.055
  return sign * encoded
}

/**
 * OKLCH -> gamma-encoded sRGB, each channel clamped to [0, 1]. Values
 * outside the sRGB gamut (routine at high chroma) are clamped rather than
 * rejected, matching how a browser actually renders an out-of-gamut OKLCH
 * colour on an sRGB display.
 */
export function oklchToSrgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = l - 0.0894841775 * a - 1.2914855480 * b

  const lCubed = lPrime ** 3
  const mCubed = mPrime ** 3
  const sCubed = sPrime ** 3

  const rLinear = 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed
  const gLinear = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed
  const bLinear = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.7076147010 * sCubed

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  return [
    clamp01(srgbGammaEncode(rLinear)),
    clamp01(srgbGammaEncode(gLinear)),
    clamp01(srgbGammaEncode(bLinear)),
  ]
}

/** Simple "over" alpha compositing in gamma-encoded sRGB space: close enough
 *  for a contrast estimate, and the same simplification every practical
 *  contrast-checking tool makes (true linear-light compositing is not what
 *  a WCAG/APCA number is meant to certify anyway). */
function compositeOver(fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ]
}

function resolveRgb(value: string, against: [number, number, number]): [number, number, number] {
  const parsed = parseOklch(value)
  const rgb = oklchToSrgb(parsed.l, parsed.c, parsed.h)
  return parsed.alpha >= 1 ? rgb : compositeOver(rgb, parsed.alpha, against)
}

function linearizeWcag(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance (the `Y` in the 2.2 contrast-ratio formula). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearizeWcag(r) + 0.7152 * linearizeWcag(g) + 0.0722 * linearizeWcag(b)
}

/**
 * WCAG 2.2 contrast ratio (1-21). `fg`/`bg` are `oklch(...)` strings; if
 * `fg` carries an alpha (a border or ring token), it is composited over
 * `bg` first, since that is what actually reaches the screen.
 */
export function wcagRatio(fg: string, bg: string): number {
  const bgParsed = parseOklch(bg)
  const bgRgb = oklchToSrgb(bgParsed.l, bgParsed.c, bgParsed.h)
  const fgRgb = resolveRgb(fg, bgRgb)

  const l1 = relativeLuminance(fgRgb)
  const l2 = relativeLuminance(bgRgb)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** APCA (Accessible Perceptual Contrast Algorithm) uses a plain power-curve
 *  luminance, not the piecewise WCAG transfer function (this is APCA's own
 *  documented departure from WCAG, not a mistake). */
function apcaY([r, g, b]: [number, number, number]): number {
  return 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.0721750 * b ** 2.4
}

/**
 * APCA `Lc` (APCA 0.1.9 / "apca-w3" reference constants), unsigned — the
 * spec's thresholds (`Lc >= 75/60/45`) are magnitudes, and polarity (light
 * text on dark vs. dark text on light) is handled internally by the
 * algorithm's two branches, not by the caller.
 */
export function apcaLc(fg: string, bg: string): number {
  const bgParsed = parseOklch(bg)
  const bgRgb = oklchToSrgb(bgParsed.l, bgParsed.c, bgParsed.h)
  const fgRgb = resolveRgb(fg, bgRgb)

  const normBG = 0.56
  const normTXT = 0.57
  const revTXT = 0.62
  const revBG = 0.65
  const blkThrs = 0.022
  const blkClmp = 1.414
  const loClip = 0.1
  const deltaYmin = 0.0005
  const scale = 1.14
  const loOffset = 0.027

  let yTxt = apcaY(fgRgb)
  let yBg = apcaY(bgRgb)
  yTxt = yTxt > blkThrs ? yTxt : yTxt + (blkThrs - yTxt) ** blkClmp
  yBg = yBg > blkThrs ? yBg : yBg + (blkThrs - yBg) ** blkClmp

  if (Math.abs(yBg - yTxt) < deltaYmin) return 0

  let contrast: number
  if (yBg > yTxt) {
    const sapc = (yBg ** normBG - yTxt ** normTXT) * scale
    contrast = sapc < loClip ? 0 : sapc - loOffset
  } else {
    const sapc = (yBg ** revBG - yTxt ** revTXT) * scale
    contrast = sapc > -loClip ? 0 : sapc + loOffset
  }

  return Math.abs(contrast) * 100
}
