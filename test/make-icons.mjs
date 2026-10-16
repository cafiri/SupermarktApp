// Icons neu erzeugen: npm i --no-save sharp && node test/make-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icon.svg');
await sharp(svg).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(svg).resize(512, 512).png().toFile('public/icon-512.png');
await sharp(svg).resize(180, 180).png().toFile('public/apple-touch-icon.png');
// Maskable: Inhalt mit Rand, volle Fläche grün
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2E5E3E' } })
  .composite([{ input: inner, left: 56, top: 56 }]).png().toFile('public/icon-maskable-512.png');
console.log('icons ok');
