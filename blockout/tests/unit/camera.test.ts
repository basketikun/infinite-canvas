import { describe, expect, it } from 'vitest'
import { verticalFov, horizontalFov, frameSubject, SENSORS, dofBlurAmount } from '@engine/camera'

const DEG = 180 / Math.PI

describe('camera optics', () => {
  it('matches published horizontal FOV for 35mm lens on Super 35', () => {
    // hfov = 2·atan(24.89 / (2·35)) ≈ 39.1°
    expect(horizontalFov('super35', 35) * DEG).toBeCloseTo(39.15, 0)
  })

  it('matches published horizontal FOV for 50mm on full frame', () => {
    // Classic ~39.6° horizontal for 50mm on 36mm-wide gate.
    expect(horizontalFov('fullFrame', 50) * DEG).toBeCloseTo(39.6, 0)
  })

  it('computes vertical FOV from aspect-cropped sensor height', () => {
    const vfov = verticalFov('super35', 35, '16:9')
    const expectedHeight = SENSORS.super35.width / (16 / 9)
    expect(vfov).toBeCloseTo(2 * Math.atan(expectedHeight / 70), 6)
  })

  it('wider aspect crops vertically (smaller vfov)', () => {
    expect(verticalFov('super35', 35, '2.39:1')).toBeLessThan(verticalFov('super35', 35, '16:9'))
  })

  it('longer lens → narrower FOV', () => {
    expect(verticalFov('super35', 85, '16:9')).toBeLessThan(verticalFov('super35', 24, '16:9'))
  })

  it('auto-framing: closer shot sizes need less distance', () => {
    const ws = frameSubject('WS', 1.8, 'super35', 35, '16:9')
    const ms = frameSubject('MS', 1.8, 'super35', 35, '16:9')
    const cu = frameSubject('CU', 1.8, 'super35', 35, '16:9')
    expect(ws.distance).toBeGreaterThan(ms.distance)
    expect(ms.distance).toBeGreaterThan(cu.distance)
    expect(cu.distance).toBeGreaterThan(0)
  })

  it('auto-framing: longer lens needs more distance for the same size', () => {
    const at35 = frameSubject('MS', 1.8, 'super35', 35, '16:9')
    const at85 = frameSubject('MS', 1.8, 'super35', 85, '16:9')
    expect(at85.distance).toBeGreaterThan(at35.distance)
  })

  it('CU aims near head height', () => {
    const cu = frameSubject('CU', 1.8, 'super35', 50, '16:9')
    expect(cu.targetHeight).toBeGreaterThan(1.5)
    expect(cu.targetHeight).toBeLessThan(1.8)
  })

  it('DOF blur grows with focus miss and focal length', () => {
    expect(dofBlurAmount(2, 2, 50)).toBe(0)
    // Small miss (below saturation): longer lens blurs more.
    expect(dofBlurAmount(4, 5, 85)).toBeGreaterThan(dofBlurAmount(4, 5, 35))
    // Blur saturates at 1 for huge misses.
    expect(dofBlurAmount(1, 50, 135)).toBe(1)
  })
})
