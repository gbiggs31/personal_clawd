/**
 * Generate PNG icons from icon-source.png for PWA manifest.
 * Run once (or after updating the source logo): node scripts/gen-icons.mjs
 */
import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

mkdirSync(resolve(root, 'public/icons'), { recursive: true })

const src = resolve(root, 'public/icon-source.png')
const bg  = { r: 0, g: 0, b: 0, alpha: 1 }

/**
 * Build a sharp pipeline that:
 *  1. Trims the black border from the source
 *  2. Resizes the logo to `fillPct`% of the target canvas
 *  3. Extends back to `canvasSize` × `canvasSize` with a black background
 */
async function makeIcon(canvasSize, fillPct) {
  const logoSize = Math.round(canvasSize * fillPct)
  const totalPad = canvasSize - logoSize
  const padA     = Math.floor(totalPad / 2)
  const padB     = totalPad - padA   // padA or padA+1, handles odd remainders

  const buf = await sharp(src)
    .trim({ background: '#000000', threshold: 20 })
    .resize(logoSize, logoSize, { fit: 'contain', background: bg })
    .extend({ top: padA, bottom: padB, left: padA, right: padB, background: bg })
    .flatten({ background: bg })
    .png()
    .toBuffer()

  return buf
}

// Standard icons — logo fills 82% of canvas
for (const [name, size] of [
  ['icon-192.png',         192],
  ['icon-512.png',         512],
  ['apple-touch-icon.png', 180],
]) {
  const buf = await makeIcon(size, 0.82)
  await sharp(buf).toFile(resolve(root, 'public/icons', name))
  console.log(`✓ ${name}`)
}

// Maskable icon — logo fills 72% so the artwork stays within the
// inner-80% safe zone that Android uses when cropping to circle/squircle
const maskBuf = await makeIcon(512, 0.72)
await sharp(maskBuf).toFile(resolve(root, 'public/icons/icon-512-maskable.png'))
console.log('✓ icon-512-maskable.png')

console.log('\nIcons written to public/icons/')
