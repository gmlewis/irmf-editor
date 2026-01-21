import { test, expect } from '@playwright/test'

test.describe('IRMF Editor Visual Regression', () => {
  test('Initial Load', async ({ page }) => {
    await page.goto('/')
    // Wait for the canvas to be visible
    await page.waitForSelector('#canvas')
    // Wait for WASM to be ready
    await expect(page.locator('#logf')).toContainText('Application irmf-editor is now started', { timeout: 30000 })
    // Wait for a bit for the model to render
    await page.waitForTimeout(5000)
    await expect(page).toHaveScreenshot('initial-load.png')
  })

  test('Reset View Button exists and looks right', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#logf')).toContainText('Application irmf-editor is now started', { timeout: 30000 })
    const resetViewBtn = page.locator('.dg .cr.function', { hasText: 'Reset View' })
    await expect(resetViewBtn).toBeVisible()
    await expect(resetViewBtn).toHaveScreenshot('reset-view-button.png')
  })

  test('Seamless rotation from ortho to persp', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#logf')).toContainText('Application irmf-editor is now started', { timeout: 30000 })
    await page.waitForTimeout(5000)

    // Click in the HUD area to go to "Front" view.
    // The HUD is in the top-right corner.
    // Based on visual inspection of 1280x720 screenshot:
    // HUD area is roughly x=[1024, 1280], y=[0, 256].
    // The "FRONT" face center is at (1116, 154) per Gimp measurement.
    await page.mouse.click(1116, 154)
    await page.waitForTimeout(2000)
    
    // Take screenshot of Ortho Front view
    await expect(page).toHaveScreenshot('front-ortho.png')

    // Drag in the middle of the main canvas to rotate.
    // The canvas is on the right half of the 1280x720 viewport (x > 640).
    // Let's drag at (900, 400).
    await page.mouse.move(900, 400)
    await page.mouse.down()
    await page.mouse.move(800, 300)
    await page.mouse.up()
    
    await page.waitForTimeout(2000)
    // Verify it switched to perspective and rotated smoothly
    await expect(page).toHaveScreenshot('rotated-persp.png')
  })
})
