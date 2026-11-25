import type { Browser, BrowserContext } from '@playwright/test'
import { CLIENT_ID_KEY } from '../src/state/clientId'
import { LEGACY_PLANS_KEY, LEGACY_SAVED_KEY } from '../src/state/legacyStorage'
import { WEATHER_URL, daysAhead, expect, openApp, test } from './fixtures'

/** A separate browser profile: its own localStorage, so its own anonymous id, like another phone. */
async function phone(browser: Browser, baseURL: string | undefined, init?: (context: BrowserContext) => Promise<void>) {
  const context = await browser.newContext({ baseURL })
  await context.route(WEATHER_URL, (route) => route.fulfill({ json: { current: { temperature_2m: 49.6, weather_code: 61 } } }))
  if (init) await init(context)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  return { context, page, errors }
}

test.describe('other devices', () => {
  test('two phones each see only their own saved places, and a hard refresh keeps them', async ({ browser, baseURL }) => {
    const a = await phone(browser, baseURL)
    const b = await phone(browser, baseURL)
    try {
      await openApp(a.page)
      const heart = a.page.getByTestId('place-card').first().getByTestId('save-toggle')
      await heart.click()
      await expect(heart).toHaveAttribute('aria-pressed', 'true')

      await openApp(b.page)
      await b.page.getByTestId('nav-heart').click()
      await expect(b.page.getByTestId('saved-empty')).toBeVisible()

      await a.page.reload({ waitUntil: 'load' })
      await a.page.getByTestId('nav-heart').click()
      await expect(a.page.getByTestId('saved-row')).toHaveCount(1)

      const idA = await a.page.evaluate((key) => localStorage.getItem(key), CLIENT_ID_KEY)
      const idB = await b.page.evaluate((key) => localStorage.getItem(key), CLIENT_ID_KEY)
      expect(idA).toMatch(/^[0-9a-f-]{36}$/)
      expect(idB).toMatch(/^[0-9a-f-]{36}$/)
      expect(idA).not.toBe(idB)
      expect([...a.errors, ...b.errors]).toEqual([])
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('saved data from the pre-backend version uploads under this browser’s new id, once', async ({ browser, baseURL }) => {
    const planDate = daysAhead(2)
    const old = await phone(browser, baseURL, (context) =>
      context.addInitScript(
        ([savedKey, plansKey, date]) => {
          if (sessionStorage.getItem('seeded')) return
          sessionStorage.setItem('seeded', '1')
          localStorage.setItem(savedKey, JSON.stringify(['canlis']))
          localStorage.setItem(plansKey, JSON.stringify([{ placeId: 'wolf', date, time: '19:00' }]))
        },
        [LEGACY_SAVED_KEY, LEGACY_PLANS_KEY, planDate] as const,
      ),
    )
    const other = await phone(browser, baseURL)
    try {
      await openApp(old.page)
      await old.page.getByTestId('nav-heart').click()
      await expect(old.page.getByTestId('saved-row')).toHaveCount(1)
      await expect(old.page.getByTestId('saved-row')).toHaveAttribute('data-place-id', 'canlis')

      const id = await old.page.evaluate((key) => localStorage.getItem(key), CLIENT_ID_KEY)
      const plans = (await (await old.context.request.get('/api/plans', { headers: { 'x-client-id': id! } })).json()).plans
      expect(plans).toMatchObject([{ placeId: 'wolf', date: planDate, time: '19:00' }])
      expect(await old.page.evaluate(([s, p]) => [localStorage.getItem(s), localStorage.getItem(p)], [LEGACY_SAVED_KEY, LEGACY_PLANS_KEY] as const)).toEqual([null, null])

      // A reload does not upload again.
      await old.page.reload()
      await old.page.getByTestId('nav-heart').click()
      await expect(old.page.getByTestId('saved-row')).toHaveCount(1)
      expect((await (await old.context.request.get('/api/plans', { headers: { 'x-client-id': id! } })).json()).plans).toHaveLength(1)

      await openApp(other.page)
      await other.page.getByTestId('nav-heart').click()
      await expect(other.page.getByTestId('saved-empty')).toBeVisible()
      expect([...old.errors, ...other.errors]).toEqual([])
    } finally {
      await old.context.close()
      await other.context.close()
    }
  })
})
