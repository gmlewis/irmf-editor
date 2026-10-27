import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EXAMPLES = process.env.IRMF_EXAMPLES_DIR || ''
const example = (rel: string) => readFileSync(join(EXAMPLES, 'examples', rel), 'utf8')
const url = (rel: string) => '/?file=/examples/' + rel

test.describe.configure({ timeout: 90000 })

async function loadTSL(page, rel: string) {
  const logs: string[] = []
  page.on('console', (m) => logs.push(m.text()))
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message))
  await page.addInitScript(() => { window.__irmfTSLForceWebGL = true })
  await page.goto(url(rel))
  await page.waitForFunction(
    () => window.IRMFTSL && window.IRMFTSL.status === 'loaded',
    null,
    { timeout: 60000 }
  )
  return logs
}

test.describe('TSL editor support', () => {
  test.skip(!EXAMPLES, 'IRMF_EXAMPLES_DIR is required to mount examples')

  test('loads and renders a TSL sphere', async ({ page }) => {
    const logs = await loadTSL(page, '001-sphere/sphere-1-tsl.irmf')

    expect(await page.evaluate(() => {
      const m = window.getEditor().getModel()
      return m.getLanguageId ? m.getLanguageId() : m.getModeId()
    })).toBe('tsl')
    await expect(page.locator('#tsl-canvas')).toBeVisible()
    await expect(page.locator('#gpu-canvas')).toBeHidden()

    const shot = await page.locator('#tsl-canvas').screenshot()
    expect(shot.length).toBeGreaterThan(1000)
    expect(logs.join('\n')).not.toContain('PAGEERROR')
  })

  test('renders a two-material TSL model and updates the color GUI', async ({ page }) => {
    await loadTSL(page, '001-sphere/sphere-3-tsl.irmf')
    await expect(page.locator('#logf')).toContainText('2 materials')
    // dat.GUI folder name is rendered in the DOM.
    await expect(page.locator('#gui')).toContainText('Material colors (2)')
  })

  test('renders a full-color HSV TSL model', async ({ page }) => {
    await loadTSL(page, '019-full-color/full-color-1-tsl.irmf')
    await expect(page.locator('#gui')).toContainText('Material colors (0)')
    const shot = await page.locator('#tsl-canvas').screenshot()
    expect(shot.length).toBeGreaterThan(1000)
  })

  test('switches GLSL -> TSL -> GLSL in place', async ({ page }) => {
    await page.addInitScript(() => { window.__irmfTSLForceWebGL = true })
    await page.goto(url('002-cube/cube-2.irmf'))
    await page.waitForFunction(() => window.getEditor && window.getEditor())

    const editor = page.locator('.monaco-editor').first()
    await editor.click()

    // Switch to TSL by replacing the buffer and recompiling.
    const tsl = example('002-cube/cube-2-tsl.irmf')
    await page.evaluate((src) => window.getEditor().setValue(src), tsl)
    await page.keyboard.press('Control+Enter')
    await page.waitForFunction(
      () => window.IRMFTSL && window.IRMFTSL.status === 'loaded',
      null,
      { timeout: 60000 }
    )
    await expect(page.locator('#tsl-canvas')).toBeVisible()
    expect(await page.evaluate(() => {
      const m = window.getEditor().getModel()
      return m.getLanguageId ? m.getLanguageId() : m.getModeId()
    })).toBe('tsl')

    // Switch back to GLSL.
    const glsl = example('002-cube/cube-2.irmf')
    await page.evaluate((src) => window.getEditor().setValue(src), glsl)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('#tsl-canvas')).toBeHidden({ timeout: 30000 })
    expect(await page.evaluate(() => {
      const m = window.getEditor().getModel()
      return m.getLanguageId ? m.getLanguageId() : m.getModeId()
    })).toBe('glsl')
  })

  test('reports a TSL compilation error with a line', async ({ page }) => {
    await loadTSL(page, '001-sphere/sphere-1-tsl.irmf')
    const editor = page.locator('.monaco-editor').first()
    await editor.click()

    const bad = [
      '/*{',
      '  "irmf": "1.0",',
      '  "language": "tsl",',
      '  "tslVersion": "0.180.0",',
      '  "materials": ["PLA"],',
      '  "min": [-1,-1,-1],',
      '  "max": [1,1,1],',
      '  "units": "mm"',
      '}*/',
      'const mainModel4 = (xyz) => {',
      '  const broken = ;',
      '  return [float(1)];',
      '};',
      '',
    ].join('\n')
    await page.evaluate((src) => window.getEditor().setValue(src), bad)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('#logf')).toContainText('TSL COMPILATION ERROR', { timeout: 30000 })
  })

  test('rejects a TSL model without the required entry point', async ({ page }) => {
    await loadTSL(page, '001-sphere/sphere-1-tsl.irmf')
    const editor = page.locator('.monaco-editor').first()
    await editor.click()

    const bad = [
      '/*{',
      '  "irmf": "1.0",',
      '  "language": "tsl",',
      '  "tslVersion": "0.180.0",',
      '  "materials": ["PLA"],',
      '  "min": [-1,-1,-1],',
      '  "max": [1,1,1],',
      '  "units": "mm"',
      '}*/',
      'const sphere = (r, p) => float(1);',
      '',
    ].join('\n')
    await page.evaluate((src) => window.getEditor().setValue(src), bad)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('#logf')).toContainText('mainModel4', { timeout: 30000 })
  })

  test('confirms before running remote TSL', async ({ page }) => {
    await loadTSL(page, '001-sphere/sphere-1-tsl.irmf')
    let seen = ''
    page.on('dialog', async (d) => {
      seen = d.message()
      await d.accept()
    })
    const ok = await page.evaluate(() => window.confirmRemoteTSL(true))
    expect(ok).toBe(true)
    expect(seen).toContain('executable JavaScript')
  })

  test('keeps the TSL camera in sync while rotating', async ({ page }) => {
    // Regression test: the runtime used to copy camera.matrixWorld, which the
    // legacy renderer had not updated yet (TSL renders first), so fast drags
    // made the model lag and jump. It must mirror position/quaternion directly.
    await loadTSL(page, '002-cube/cube-2-tsl.irmf')
    const box = await page.locator('#canvas').boundingBox()
    if (!box) throw new Error('no canvas')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + i * 22, cy + i * 9)
      const { legacy, tsl } = await page.evaluate(() => ({
        legacy: window.getIRMFDebugState(),
        tsl: window.IRMFTSL.debug,
      }))
      const maxDelta = (a, b) => Math.max(...a.map((v, j) => Math.abs(v - b[j])))
      expect(maxDelta(legacy.camera.position, tsl.camera.position)).toBeLessThan(1e-6)
      expect(maxDelta(legacy.camera.quaternion, tsl.camera.quaternion)).toBeLessThan(1e-6)
    }
    await page.mouse.up()
  })

  test('resizes the TSL canvas', async ({ page }) => {
    await loadTSL(page, '001-sphere/sphere-1-tsl.irmf')
    const before = await page.evaluate(() => document.getElementById('tsl-canvas').width)
    await page.setViewportSize({ width: 1000, height: 600 })
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => document.getElementById('tsl-canvas').width)
    expect(after).not.toBe(before)
    expect(after).toBeGreaterThan(0)
  })
})
