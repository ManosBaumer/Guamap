import fs from 'node:fs'
import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleTransitRouteRequest } from './server/transitRouteHandler'

/** Personal favourites: `data/saved_listings.json` (gitignored). Served only by dev/preview. */
const SAVED_LISTINGS_FILE = path.resolve(__dirname, '../data/saved_listings.json')

function savedListingsApiMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (url !== '/api/saved-listings') {
      next()
      return
    }

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      try {
        if (!fs.existsSync(SAVED_LISTINGS_FILE)) {
          res.statusCode = 200
          res.end('[]')
          return
        }
        const raw = fs.readFileSync(SAVED_LISTINGS_FILE, 'utf8').trim()
        res.statusCode = 200
        res.end(raw === '' ? '[]' : raw)
      } catch {
        res.statusCode = 500
        res.end(JSON.stringify({ error: 'read_failed' }))
      }
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (c) => {
        chunks.push(c as Buffer)
      })
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const body = Buffer.concat(chunks).toString('utf8') || '[]'
          const parsed = JSON.parse(body) as unknown
          if (!Array.isArray(parsed)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'expected_json_array' }))
            return
          }
          fs.mkdirSync(path.dirname(SAVED_LISTINGS_FILE), { recursive: true })
          fs.writeFileSync(SAVED_LISTINGS_FILE, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
          res.statusCode = 204
          res.end()
        } catch {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'write_failed' }))
        }
      })
      return
    }

    res.statusCode = 405
    res.end()
  }
}

function savedListingsFilePlugin() {
  return {
    name: 'guamap-saved-listings-file',
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(savedListingsApiMiddleware())
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(savedListingsApiMiddleware())
    },
  }
}

function transitRouteApiMiddleware(amapKey: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (url !== '/api/transit-route') {
      next()
      return
    }
    void handleTransitRouteRequest(req, res, amapKey)
  }
}

function transitRouteApiPlugin(amapKey: string) {
  return {
    name: 'guamap-transit-route-api',
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(transitRouteApiMiddleware(amapKey))
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(transitRouteApiMiddleware(amapKey))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const amapKey = env.AMAP_KEY ?? process.env.AMAP_KEY ?? ''

  return {
  plugins: [react(), tailwindcss(), savedListingsFilePlugin(), transitRouteApiPlugin(amapKey)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Prevent "Multiple instances of Three.js being imported" warnings.
      // Photo Sphere Viewer depends on three; ensuring a single resolved copy
      // helps avoid duplicate bundling.
      three: path.resolve(__dirname, './node_modules/three/build/three.module.js'),
    },
  },
  build: {
    sourcemap: false,
  },
  }
})
