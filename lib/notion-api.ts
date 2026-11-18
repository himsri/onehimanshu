import { NotionAPI } from 'notion-client'

// Notion's Cloudflare edge rejects unofficial api/v3 requests that carry no
// User-Agent (Node's fetch sends none), returning 403 on loadPageChunk.
// See https://github.com/NotionX/react-notion-x/issues/710
const userAgent =
  process.env.NOTION_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export const notion = new NotionAPI({
  apiBaseUrl: process.env.NOTION_API_BASE_URL,
  activeUser: process.env.NOTION_ACTIVE_USER,
  authToken: process.env.NOTION_TOKEN_V2,
  ofetchOptions: {
    headers: {
      'User-Agent': userAgent
    },
    // Notion rate-limits bursts (429); back off and retry instead of failing
    retry: 4,
    retryDelay: (ctx) => 1000 * 2 ** (4 - ((ctx.options.retry as number) ?? 0)),
    retryStatusCodes: [429, 500, 502, 503, 504]
  }
})
