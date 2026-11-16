// Renders the PNG icons from apps/web/public/icon.svg (run once after changing the icon):
//   NODE_PATH=$(npm root -g) node tools/icons.mjs
// Uses Playwright's Chromium, so no image library is needed.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is installed globally (NODE_PATH=$(npm root -g)), not as a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = new URL('../apps/web/public/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir), 'utf8');
// Maskable: full-bleed background, content inside the 80 % safe zone.
const maskable = svg
  .replace('rx="112"', 'rx="0"')
  .replace(/(<rect x)/, '<g transform="translate(51.2 51.2) scale(0.8)">$1')
  .replace('</svg>', '</g></svg>');

const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (source, size, file) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(file, dir).pathname, omitBackground: true });
};
await render(svg, 192, 'icon-192.png');
await render(svg, 512, 'icon-512.png');
await render(maskable, 512, 'icon-maskable-512.png');
await render(maskable, 180, 'apple-touch-icon.png');
await browser.close();
