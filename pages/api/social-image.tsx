import { readFileSync } from 'fs'
import { join } from 'path'

import * as React from 'react'
import { ImageResponse } from '@vercel/og'
import type { NextApiRequest, NextApiResponse } from 'next'

import { api, apiHost, rootNotionPageId } from '@/lib/config'
import { NotionPageInfo } from '@/lib/types'

// Using Node.js runtime to avoid the 1 MB Edge Function size limit.
// @vercel/og bundles resvg.simd.wasm (~1.1 MB) which exceeds the Edge limit
// on Vercel's Hobby plan. Node.js Serverless Functions have a 50 MB limit.
//
// Note: NextRequest / import.meta.url must NOT be used here — both trigger
// Vercel's automatic Edge runtime detection and override this config.
export const config = {
  runtime: 'nodejs'
}

// Load fonts from the filesystem at module initialisation time.
// readFileSync is used instead of fetch(new URL(..., import.meta.url))
// because import.meta.url is an ES-module pattern that also triggers Edge
// runtime detection in Next.js 12.
const interRegularFont = readFileSync(
  join(process.cwd(), 'public/fonts/Inter-Regular.ttf')
)
const interBoldFont = readFileSync(
  join(process.cwd(), 'public/fonts/Inter-SemiBold.ttf')
)

export default async function OGImage(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const pageId = (req.query.id as string) || rootNotionPageId
  if (!pageId) {
    res.status(400).send('Invalid notion page id')
    return
  }

  const pageInfoRes = await fetch(`${apiHost}${api.getNotionPageInfo}`, {
    method: 'POST',
    body: JSON.stringify({ pageId }),
    headers: {
      'content-type': 'application/json'
    }
  })

  if (!pageInfoRes.ok) {
    res.status(pageInfoRes.status).send(pageInfoRes.statusText)
    return
  }

  const pageInfo: NotionPageInfo = await pageInfoRes.json()
  console.log(pageInfo)

  // ImageResponse returns a Web API Response object. We convert its body to
  // a Buffer so it can be sent via the Node.js res object.
  const imageResponse = new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#1F2027',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '"Inter", sans-serif',
          color: 'black'
        }}
      >
        {pageInfo.image && (
          <img
            src={pageInfo.image}
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
          />
        )}

        <div
          style={{
            position: 'relative',
            width: 900,
            height: 465,
            display: 'flex',
            flexDirection: 'column',
            border: '16px solid rgba(0,0,0,0.3)',
            borderRadius: 8,
            zIndex: '1'
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-around',
              backgroundColor: '#fff',
              padding: 24,
              alignItems: 'center',
              textAlign: 'center'
            }}
          >
            {pageInfo.detail && (
              <div style={{ fontSize: 32, opacity: 0 }}>{pageInfo.detail}</div>
            )}

            <div
              style={{
                fontSize: 70,
                fontWeight: 700,
                fontFamily: 'Inter'
              }}
            >
              {pageInfo.title}
            </div>

            {pageInfo.detail && (
              <div style={{ fontSize: 32, opacity: 0.6 }}>
                {pageInfo.detail}
              </div>
            )}
          </div>
        </div>

        {pageInfo.authorImage && (
          <div
            style={{
              position: 'absolute',
              top: 47,
              left: 104,
              height: 128,
              width: 128,
              display: 'flex',
              borderRadius: '50%',
              border: '4px solid #fff',
              zIndex: '5'
            }}
          >
            <img
              src={pageInfo.authorImage}
              style={{
                width: '100%',
                height: '100%'
              }}
            />
          </div>
        )}
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Inter',
          data: interRegularFont,
          style: 'normal',
          weight: 400
        },
        {
          name: 'Inter',
          data: interBoldFont,
          style: 'normal',
          weight: 700
        }
      ]
    }
  )

  // Convert the Web API Response body to a Node.js Buffer and send it.
  // Cast needed because @vercel/og@0.0.19 typings don't expose arrayBuffer()
  // even though ImageResponse extends the Web API Response at runtime.
  const buffer = await (imageResponse as unknown as Response).arrayBuffer()
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
  res.end(Buffer.from(buffer))
}
