/**
 * The whole GLSL for the settle-and-freeze field (wave 4 spec §6.1: "one
 * fullscreen triangle and one fragment shader -- no scene graph, no camera,
 * no loader"). Two strings, no build step: `ShaderField.tsx` hands them to
 * `gl.shaderSource` verbatim.
 *
 * `VERTEX_SHADER` draws the classic no-buffer fullscreen triangle from
 * `gl_VertexID` alone (WebGL2 / GLSL ES 3.00) -- vertex 0 at (-1,-1),
 * vertex 1 at (3,-1), vertex 2 at (-1,3), so the triangle's hypotenuse runs
 * well past the clip-space square and the rasterised interior covers the
 * whole viewport with exactly three vertices, zero attributes and zero
 * buffers bound.
 *
 * `FRAGMENT_SHADER` reads its two colours from `uColorA`/`uColorB` --
 * uniforms `ShaderField.tsx` sets once at init from `--shader-a`/
 * `--shader-b` (spec rule 3) -- and blends them with a slow two-axis wave.
 * **Zero `vec3(` colour literals appear below**; `ShaderSurface.test.tsx`
 * greps this file's exported strings for that exact substring and fails on
 * any hit, so a future edit that hard-codes a tint instead of reading the
 * uniform is caught mechanically, not by review alone. The dither term
 * (spec rule 5) breaks up the two-stop gradient by up to ±1/255 so a near-
 * black field does not band visibly on an OLED panel.
 */

export const VERTEX_SHADER = `#version 300 es
void main() {
  int id = gl_VertexID;
  vec2 corner = vec2(float((id << 1) & 2), float(id & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;

out vec4 outColor;

float hash(vec2 seed) {
  return fract(sin(dot(seed, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float waveX = sin(uv.x * 3.1 + uTime * 0.06) * 0.5 + 0.5;
  float waveY = sin(uv.y * 2.3 - uTime * 0.045 + uv.x * 1.4) * 0.5 + 0.5;
  float blend = waveX * waveY;
  float dither = (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
  outColor = vec4(mix(uColorA, uColorB, blend) + dither, 1.0);
}
`
