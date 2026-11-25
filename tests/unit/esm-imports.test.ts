import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
/** Code the Vercel function loads as plain Node ESM, where a relative import needs its `.js` extension. */
const SERVER_LOADED = ['api', 'server/src', 'shared', 'src/data']

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? tsFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  )
}

describe('server-loaded modules', () => {
  it('use .js extensions on every relative value import (Node ESM on Vercel cannot resolve bare paths)', () => {
    const offenders = SERVER_LOADED.flatMap((dir) => tsFiles(join(ROOT, dir))).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^\s*(import|export)\s(?!type\s)[^'"]*from\s+'\.{1,2}\/[^']+'/.test(line) && !/\.js'/.test(line))
        .map((line) => `${relative(ROOT, file)}: ${line.trim()}`),
    )
    expect(offenders).toEqual([])
  })
})
