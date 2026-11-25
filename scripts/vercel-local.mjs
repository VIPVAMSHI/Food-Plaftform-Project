#!/usr/bin/env node
/**
 * Serves a `vercel build` output (.vercel/output) the way Vercel's edge does, for testing without a Vercel login:
 * header routes, then static files and the function, then rewrites (with filesystem check), then 404.
 * The function is the real bundled one (functions/api/index.func) and gets the rewritten URL (`/api?path=...`),
 * the less convenient of the two forms, so the URL handling in server/src/vercel.ts is exercised.
 *   node scripts/vercel-local.mjs [outputDir=.vercel/output] [port=3200]
 * Environment variables (DATABASE_URL, LLM_API_KEY, ...) are passed through to the function, like Vercel's settings.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OUTPUT = resolve(process.argv[2] || '.vercel/output')
const PORT = Number(process.argv[3] || process.env.PORT || 3200)
const routes = JSON.parse(readFileSync(join(OUTPUT, 'config.json'), 'utf8')).routes
const STATIC = join(OUTPUT, 'static')
const FUNC_DIR = join(OUTPUT, 'functions/api/index.func')
const vc = JSON.parse(readFileSync(join(FUNC_DIR, '.vc-config.json'), 'utf8'))

process.env.NODE_ENV = 'production'
process.env.VERCEL = '1'
const handler = (await import(pathToFileURL(join(FUNC_DIR, vc.handler)).href)).default

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain' }

const handleIndex = routes.findIndex((r) => r.handle === 'filesystem')
const errorIndex = routes.findIndex((r) => r.handle === 'error')
const before = routes.slice(0, handleIndex)
const after = routes.slice(handleIndex + 1, errorIndex)

/** Static file or the function for a path, or null. */
function lookup(path) {
  if (path === '/api' || path === '/api/index') return { fn: true }
  const file = join(STATIC, path.endsWith('/') ? `${path}index.html` : path)
  if (file.startsWith(STATIC) && existsSync(file) && statSync(file).isFile()) return { file }
  return null
}

function substitute(dest, match) {
  return dest.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? '')
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local')
  const path = decodeURIComponent(url.pathname)
  const headers = {}
  for (const route of before) {
    if (route.src && new RegExp(route.src).test(path) && route.headers) Object.assign(headers, route.headers)
  }
  const serve = async (target, query) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
    if (target.fn) {
      req.url = `/api${query ? `?${query}` : ''}`
      req.headers['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1'
      req.headers['x-forwarded-proto'] = 'https'
      return handler(req, res)
    }
    res.setHeader('Content-Type', TYPES[extname(target.file)] ?? 'application/octet-stream')
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    createReadStream(target.file).pipe(res)
  }

  const direct = lookup(path)
  if (direct && !direct.fn) return serve(direct, '')
  for (const route of after) {
    const match = route.src ? path.match(new RegExp(route.src)) : null
    if (!match) continue
    if (route.status && !route.dest) {
      res.statusCode = route.status
      return res.end('The page could not be found\n\nNOT_FOUND\n')
    }
    if (route.dest) {
      const dest = new URL(substitute(route.dest, match), 'http://local')
      for (const [key, value] of url.searchParams) if (!dest.searchParams.has(key)) dest.searchParams.append(key, value)
      const target = lookup(dest.pathname)
      if (target) return serve(target, dest.searchParams.toString())
    }
  }
  if (direct?.fn) return serve(direct, url.searchParams.toString())
  res.statusCode = 404
  res.end('The page could not be found\n\nNOT_FOUND\n')
}).listen(PORT, '127.0.0.1', () => console.log(`vercel-local: ${OUTPUT} on http://127.0.0.1:${PORT}`))
