import { processTransitRouteBody } from '../../server/transitRouteHandler'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  const amapKey = process.env.AMAP_KEY ?? ''
  const { status, payload } = await processTransitRouteBody(body, amapKey, {
    useFileCache: false,
  })

  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS })
}
