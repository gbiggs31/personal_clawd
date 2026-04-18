/**
 * Generate PNG icons from icon.svg for PWA manifest.
 * Run once: node scripts/gen-icons.mjs
 */
import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

mkdirSync(resolve(root, 'public/icons'), { recursive: true })

const svg = readFileSync(resolve(root, 'public/icon.svg'))

const sizes = [
  { name: 'icon-192.png',          size: 192 },
  { name: 'icon-512.png',          size: 512 },
  { name: 'apple-touch-icon.png',  size: 180 },
]

for (const { name, size } of sizes) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(resolve(root, 'public/icons', name))
  console.log(`✓ ${name}`)
}

// Maskable icon: add extra padding (safe zone = inner 80%)
const maskablePad = Math.round(512 * 0.12) // 12% padding each side
await sharp(svg)
  .resize(512 - maskablePad * 2, 512 - maskablePad * 2)
  .extend({
    top: maskablePad, bottom: maskablePad,
    left: maskablePad, right: maskablePad,
    background: { r: 9, g: 11, b: 16, alpha: 1 },
  })
  .png()
  .toFile(resolve(root, 'public/icons/icon-512-maskable.png'))
console.log('✓ icon-512-maskable.png')

console.log('\nIcons written to public/icons/')
