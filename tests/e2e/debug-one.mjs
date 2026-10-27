import { chromium } from '@playwright/test'
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-angle=metal','--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
page.on('console', m => { if (m.type()==='error') console.log('CONSOLE-ERROR', m.text()) })
await page.goto('http://localhost:1234/?file=/examples/012-bifilar-electromagnet/axial+radial-bifilar-electromagnet-with-solid-core-tsl.irmf')
for (let i=0;i<12;i++) {
  await page.waitForTimeout(2000)
  const st = await page.evaluate(() => window.IRMFTSL && window.IRMFTSL.status)
  console.log('t+'+(2*(i+1))+'s status=', st)
  if (st === 'loaded') break
}
console.log('log=', (await page.evaluate(() => document.getElementById('logf').innerText)).replace(/\n/g,' | '))
await page.locator('#two').screenshot({ path: '/tmp/irmf-tsl-baseline/em-3mat-tsl.png' })
await browser.close()
