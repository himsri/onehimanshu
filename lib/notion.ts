import {
  type ExtendedRecordMap,
  type SearchParams,
  type SearchResults
} from 'notion-types'
import { getBlockValue, mergeRecordMaps } from 'notion-utils'
import pMap from 'p-map'
import pMemoize from 'p-memoize'

import {
  isPreviewImageSupportEnabled,
  navigationLinks,
  navigationStyle
} from './config'
import { getTweetsMap } from './get-tweets'
import { notion } from './notion-api'
import { getPreviewImageMap } from './preview-images'

/**
 * Post-processes the recordMap for any collection that has a "Status" property.
 * Filters out rows where Status !== "Published" and sorts remaining rows by the
 * "Created" date property descending.
 *
 * This is needed because react-notion-x's unofficial API does not apply
 * view-level filters or sorts when fetching collection data.
 */
function applyCollectionFiltersAndSort(
  recordMap: ExtendedRecordMap
): ExtendedRecordMap {
  const collections = recordMap.collection || {}
  const collectionQuery = recordMap.collection_query || {}

  for (const collectionId of Object.keys(collections)) {
    // getBlockValue recursively unwraps the { value: { value: Collection } }
    // nesting that notion-client produces in the recordMap
    const collection = getBlockValue(collections[collectionId] as any) as any
    const schema = collection?.schema || {}

    // Find the internal property IDs for "Status" and "Created"
    let statusPropId: string | null = null
    let createdPropId: string | null = null

    for (const [propId, propDef] of Object.entries(schema)) {
      const def = propDef as any
      if (def.name === 'Status') statusPropId = propId
      if (def.name === 'Created') createdPropId = propId
    }

    // Only process collections that have a Status property
    if (!statusPropId) continue

    const viewQueries = collectionQuery[collectionId] || {}

    for (const viewId of Object.keys(viewQueries)) {
      const queryResult = viewQueries[viewId] as any
      if (!queryResult) continue

      // Extract blockIds — handle both flat and grouped result shapes
      const blockIds: string[] =
        queryResult?.collection_group_results?.blockIds ||
        queryResult?.blockIds ||
        []

      if (!blockIds.length) continue

      // 1. Filter: keep only rows where Status === "Published"
      const published = blockIds.filter((blockId) => {
        // getBlockValue unwraps the double-nesting on block entries too
        const block = getBlockValue(recordMap.block?.[blockId] as any) as any
        if (!block) return false
        const statusVal = block.properties?.[statusPropId!]?.[0]?.[0]
        return statusVal === 'Published'
      })

      // 2. Sort by Created date, descending
      if (createdPropId) {
        published.sort((a, b) => {
          const blockA = getBlockValue(recordMap.block?.[a] as any) as any
          const blockB = getBlockValue(recordMap.block?.[b] as any) as any

          // Date property format: [["‣", [["d", { start_date: "YYYY-MM-DD" }]]]]
          const dateA: string =
            blockA?.properties?.[createdPropId!]?.[0]?.[1]?.[0]?.[1]
              ?.start_date ?? ''
          const dateB: string =
            blockB?.properties?.[createdPropId!]?.[0]?.[1]?.[0]?.[1]
              ?.start_date ?? ''

          // Fall back to block creation timestamp if custom date is absent
          const tsA = dateA || new Date(blockA?.created_time ?? 0).toISOString()
          const tsB = dateB || new Date(blockB?.created_time ?? 0).toISOString()

          return tsB.localeCompare(tsA) // descending
        })
      }

      // Write the filtered+sorted list back into the query result
      if (queryResult?.collection_group_results?.blockIds !== undefined) {
        queryResult.collection_group_results.blockIds = published
        queryResult.collection_group_results.total = published.length
      } else if ('blockIds' in queryResult) {
        queryResult.blockIds = published
        if ('total' in queryResult) queryResult.total = published.length
      }
    }
  }

  return recordMap
}

const getNavigationLinkPages = pMemoize(
  async (): Promise<ExtendedRecordMap[]> => {
    const navigationLinkPageIds = (navigationLinks || [])
      .map((link) => link?.pageId)
      .filter(Boolean)

    if (navigationStyle !== 'default' && navigationLinkPageIds.length) {
      return pMap(
        navigationLinkPageIds,
        async (navigationLinkPageId) =>
          notion.getPage(navigationLinkPageId, {
            chunkLimit: 1,
            fetchMissingBlocks: false,
            fetchCollections: false,
            signFileUrls: false
          }),
        {
          concurrency: 4
        }
      )
    }

    return []
  }
)

export async function getPage(pageId: string): Promise<ExtendedRecordMap> {
  let recordMap = await notion.getPage(pageId)

  // Apply Status=Published filter and Created-date sort to any inline collection
  // (react-notion-x does not honour view-level filters/sorts from the Notion API)
  recordMap = applyCollectionFiltersAndSort(recordMap)

  if (navigationStyle !== 'default') {
    // ensure that any pages linked to in the custom navigation header have
    // their block info fully resolved in the page record map so we know
    // the page title, slug, etc.
    const navigationLinkRecordMaps = await getNavigationLinkPages()

    if (navigationLinkRecordMaps?.length) {
      recordMap = navigationLinkRecordMaps.reduce(
        (map, navigationLinkRecordMap) =>
          mergeRecordMaps(map, navigationLinkRecordMap),
        recordMap
      )
    }
  }

  if (isPreviewImageSupportEnabled) {
    const previewImageMap = await getPreviewImageMap(recordMap)
    ;(recordMap as any).preview_images = previewImageMap
  }

  await getTweetsMap(recordMap)

  return recordMap
}

export async function search(params: SearchParams): Promise<SearchResults> {
  return notion.search(params)
}
