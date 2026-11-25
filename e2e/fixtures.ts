import { randomUUID } from 'node:crypto'
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
import { seattleToday } from '../shared/dates'
import { CLIENT_ID_KEY } from '../src/state/clientId'

export const WEATHER_URL = 'https://api.open-meteo.com/**'

type Fixtures = {
  /** Console errors and uncaught page errors seen during the test. Asserted empty unless a test opts out. */
  consoleErrors: string[]
  allowConsoleErrors: boolean
  /** This test's anonymous browser id: fresh per test, so every test starts with no plans or favorites. */
  visitorId: string
  /** API calls made as the same visitor as `page`. */
  api: APIRequestContext
}

export const test = base.extend<Fixtures>({
  // Playwright reads fixture dependencies from this pattern, so it must be a (here empty) destructuring.
  // eslint-disable-next-line no-empty-pattern
  visitorId: async ({}, use) => use(randomUUID()),
  api: async ({ playwright, baseURL, visitorId }, use) => {
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'x-client-id': visitorId } })
    await use(api)
    await api.dispose()
  },
  allowConsoleErrors: [false, { option: true }],
  consoleErrors: async ({ page, allowConsoleErrors }, use) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    await use(errors)
    if (!allowConsoleErrors) expect(errors, 'console errors during the test').toEqual([])
  },
  page: async ({ page, visitorId }, use) => {
    // Live weather by default so runs do not depend on the venue network; failure tests override this.
    await page.route(WEATHER_URL, (route) => route.fulfill({ json: { current: { temperature_2m: 49.6, weather_code: 61 } } }))
    // The app reuses an id already in storage, so the browser and `api` act as the same visitor.
    await page.addInitScript(([key, id]) => localStorage.getItem(key) || localStorage.setItem(key, id), [CLIENT_ID_KEY, visitorId] as const)
    await use(page)
  },
})

export { expect }

export const today = () => seattleToday()

/** A date a few days ahead in Seattle, as YYYY-MM-DD. */
export function daysAhead(days: number): string {
  const [y, m, d] = today().split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export async function openApp(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByTestId('result-count')).toContainText('68 PLACES')
}

export async function ask(page: Page, message: string) {
  if (await page.getByTestId('open-assistant').isVisible()) await page.getByTestId('open-assistant').click()
  const input = page.getByTestId('chat-input')
  await input.fill(message)
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('assistant-typing')).toHaveCount(0)
}

/** True if the page shows any text that would read as a failure to an audience. */
export async function visibleErrorText(page: Page): Promise<string | null> {
  const text = await page.locator('body').innerText()
  const match = text.match(/\b(error|exception|undefined|NaN|failed to fetch|stack|500|502|503|TypeError)\b/i)
  return match ? match[0] : null
}
