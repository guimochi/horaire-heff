// One-off: rasterize the app icon into public/. Run `npx tsx scripts/make-icons.ts`, commit the PNGs.
import { chromium } from 'playwright';

// Full-bleed square (iOS rounds the corners itself); glyph stays inside the maskable safe zone.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#2447D6"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <rect x="132" y="150" width="248" height="232" rx="44"/>
    <path d="M132 222h248M204 118v60M308 118v60"/>
  </g>
  <rect x="290" y="272" width="52" height="52" rx="12" fill="#FFFFFF"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: `public/${file}`, omitBackground: false });
}
await browser.close();
