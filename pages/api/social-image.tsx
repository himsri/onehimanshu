import { type PageBlock } from 'notion-types'
import {
  getBlockIcon,
  getBlockTitle,
  getBlockValue,
  getPageProperty,
  isUrl
} from 'notion-utils'
import * as React from 'react'
import { ImageResponse } from 'next/og'
import { type NextRequest } from 'next/server'
import ky from 'ky'

import * as libConfig from '@/lib/config'
import { mapImageUrl } from '@/lib/map-image-url'
import { notion } from '@/lib/notion-api'
import { type NotionPageInfo, type PageError } from '@/lib/types'

// Use Edge runtime — next/og is designed for it and its Wasm is served from
// Vercel's CDN rather than bundled into the function, so it stays well under
// the 1 MB Edge Function size limit on the Hobby plan.
export const runtime = 'edge'

export default async function OGImage(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pageId = searchParams.get('id') || libConfig.rootNotionPageId

  if (!pageId) {
    return new Response('Invalid notion page id', { status: 400 })
  }

  // Derive base URL from the incoming request so the font fetch works in every
  // environment (local dev, Vercel preview, production) without hard-coding URLs.
  // Turbopack doesn't support new URL('...', import.meta.url) for binary assets
  // in Edge functions, so we fetch the font from the public directory at runtime.
  const baseUrl = new URL('/', req.url).href

  const [interSemiBoldFont, pageInfoResult] = await Promise.all([
    fetch(`${baseUrl}fonts/Inter-SemiBold.ttf`).then((r) => r.arrayBuffer()),
    getNotionPageInfo({ pageId })
  ])

  if (pageInfoResult.type === 'error') {
    return new Response(pageInfoResult.error.message, {
      status: pageInfoResult.error.statusCode
    })
  }

  const pageInfo = pageInfoResult.data

  return new ImageResponse(
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
              <div style={{ fontSize: 32, opacity: 0.6 }}>{pageInfo.detail}</div>
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
              style={{ width: '100%', height: '100%' }}
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
          data: interSemiBoldFont,
          style: 'normal',
          weight: 700
        }
      ]
    }
  )
}

// ---------------------------------------------------------------------------
// Page info helpers (previously in pages/api/notion-page-info.tsx)
// ---------------------------------------------------------------------------

export async function getNotionPageInfo({
  pageId
}: {
  pageId: string
}): Promise<
  { type: 'success'; data: NotionPageInfo } | { type: 'error'; error: PageError }
> {
  const recordMap = await notion.getPage(pageId)

  const keys = Object.keys(recordMap?.block || {})
  const block = getBlockValue(recordMap?.block?.[keys[0]!])

  if (!block) {
    throw new Error('Invalid recordMap for page')
  }

  const blockSpaceId = block.space_id

  if (
    blockSpaceId &&
    libConfig.rootNotionSpaceId &&
    blockSpaceId !== libConfig.rootNotionSpaceId
  ) {
    return {
      type: 'error',
      error: {
        statusCode: 400,
        message: `Notion page "${pageId}" belongs to a different workspace.`
      }
    }
  }

  const isBlogPost =
    block.type === 'page' && block.parent_table === 'collection'
  const title = getBlockTitle(block, recordMap) || libConfig.name

  const imageCoverPosition =
    (block as PageBlock).format?.page_cover_position ??
    libConfig.defaultPageCoverPosition
  const imageObjectPosition = imageCoverPosition
    ? `center ${(1 - imageCoverPosition) * 100}%`
    : undefined

  const imageBlockUrl = mapImageUrl(
    getPageProperty<string>('Social Image', block, recordMap) ||
      (block as PageBlock).format?.page_cover,
    block
  )
  const imageFallbackUrl = mapImageUrl(libConfig.defaultPageCover, block)

  const blockIcon = getBlockIcon(block, recordMap)
  const authorImageBlockUrl = mapImageUrl(
    blockIcon && isUrl(blockIcon) ? blockIcon : undefined,
    block
  )
  const authorImageFallbackUrl = mapImageUrl(libConfig.defaultPageIcon, block)

  const [authorImage, image] = await Promise.all([
    getCompatibleImageUrl(authorImageBlockUrl, authorImageFallbackUrl),
    getCompatibleImageUrl(imageBlockUrl, imageFallbackUrl)
  ])

  const author =
    getPageProperty<string>('Author', block, recordMap) || libConfig.author

  const publishedTime = getPageProperty<number>('Published', block, recordMap)
  const datePublished = publishedTime ? new Date(publishedTime) : undefined
  const date =
    isBlogPost && datePublished
      ? `${datePublished.toLocaleString('en-US', { month: 'long' })} ${datePublished.getFullYear()}`
      : undefined
  const detail = date || author || libConfig.domain

  const pageInfo: NotionPageInfo = {
    pageId,
    title,
    image,
    imageObjectPosition,
    author,
    authorImage,
    detail
  }

  return { type: 'success', data: pageInfo }
}

async function isUrlReachable(url: string | undefined | null): Promise<boolean> {
  if (!url) return false
  try {
    await ky.head(url)
    return true
  } catch {
    return false
  }
}

async function getCompatibleImageUrl(
  url: string | undefined | null,
  fallbackUrl: string | undefined | null
): Promise<string | undefined> {
  const image = (await isUrlReachable(url)) ? url : fallbackUrl

  if (image) {
    const imageUrl = new URL(image)
    if (imageUrl.host === 'images.unsplash.com') {
      if (!imageUrl.searchParams.has('w')) {
        imageUrl.searchParams.set('w', '1200')
        imageUrl.searchParams.set('fit', 'max')
        return imageUrl.toString()
      }
    }
  }

  return image ?? undefined
}
