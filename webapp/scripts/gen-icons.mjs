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
const bg  = { r: 0, g: 0, b: 0, alpha: 1 } // black background

// Standard sizes
const sizes = [
  { name: 'icon-192.png',         size: 192 },
  { name: 'icon-512.png',         size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
]

for (const { name, size } of sizes) {
  await sharp(src)
    .flatten({ background: bg })   // fill any transparency with black
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(resolve(root, 'public/icons', name))
  console.log(`✓ ${name}`)
}

// Maskable icon: Android adaptive icons crop in a circle/squircle.
// The source already has natural black padding (~20% each side), so
// resizing to 512x512 keeps the logo safely within the inner 80% safe zone.
await sharp(src)
  .flatten({ background: bg })
  .resize(512, 512, { fit: 'cover' })
  .png()
  .toFile(resolve(root, 'public/icons/icon-512-maskable.png'))
console.log('✓ icon-512-maskable.png')

console.log('\nIcons written to public/icons/')
