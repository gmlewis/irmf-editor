import { chromium } from '@playwright/test'
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-angle=metal','--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
async function load(url, name) {
  await page.goto('http://localhost:1234' + url)
  await page.waitForTimeout(4500)
  console.log(name, 'status=', await page.evaluate(() => window.IRMFTSL && window.IRMFTSL.status))
  await page.locator('#two').screenshot({ path: `/tmp/irmf-tsl-baseline/${name}.png` })
}
for (const [dir, base] of [['029-gsdf-bolt','bolt'],['032-gsdf-metric-spacer','M3x5'],['033-gsdf-npt-flange','npt-flange']]) {
  await load(`/?file=/examples/${dir}/${base}.irmf`, `${base}-glsl`)
  await load(`/?file=/examples/${dir}/${base}-tsl.irmf`, `${base}-tsl`)
}
await browser.close()
