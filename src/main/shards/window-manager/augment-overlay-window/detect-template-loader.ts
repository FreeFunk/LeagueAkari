import { LeagueClientMain } from '@main/shards/league-client'
import { GtimgApi } from '@shared/data-sources/gtimg'
import { formatError } from '@shared/utils/errors'
import axios from 'axios'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { AkariLogger } from '../../logger-factory'

/**
 * 图标模板归一化尺寸, 识别时截取的图标区域会缩放到该尺寸做像素比对
 */
export const TEMPLATE_SIZE = 24

export interface AugmentIconTemplate {
  augmentId: number

  /**
   * TEMPLATE_SIZE * TEMPLATE_SIZE * 4 的像素数据
   */
  pixels: Uint8Array
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_CONCURRENCY = 8

/**
 * 海克斯图标模板加载器
 *
 * 竞技场 (CHERRY) 图标来自 LCU 资产 (cherry-augments.json 的 augmentSmallIconPath),
 * 大乱斗 (KIWI) 图标来自 gtimg CDN (kiwi_augments.json)。
 * 全部归一化为 TEMPLATE_SIZE 见方的像素数据供模板匹配使用。
 */
export class AugmentDetectTemplateLoader {
  private readonly _gtimg: GtimgApi
  private _cache: AugmentIconTemplate[] | null = null
  private _cacheTime = 0
  private _building: Promise<AugmentIconTemplate[]> | null = null

  constructor(
    private readonly _leagueClient: LeagueClientMain,
    private readonly _logger: AkariLogger
  ) {
    this._gtimg = new GtimgApi(
      axios.create({
        timeout: 15000,
        headers: { 'User-Agent': GtimgApi.USER_AGENT }
      })
    )
  }

  async ensureTemplates(force = false): Promise<AugmentIconTemplate[]> {
    if (
      !force &&
      this._cache &&
      this._cache.length > 0 &&
      Date.now() - this._cacheTime < CACHE_TTL_MS
    ) {
      return this._cache
    }

    if (this._building) {
      return this._building
    }

    this._building = this._build()
      .then((templates) => {
        if (templates.length > 0) {
          this._cache = templates
          this._cacheTime = Date.now()
        }

        return templates
      })
      .finally(() => {
        this._building = null
      })

    return this._building
  }

  private async _build(): Promise<AugmentIconTemplate[]> {
    const tasks: Array<() => Promise<AugmentIconTemplate | null>> = []

    try {
      const { data: cherryAugments } = await this._leagueClient.api.gameData.getAugments()

      for (const augment of cherryAugments) {
        const iconPath = augment.augmentSmallIconPath

        if (!iconPath) {
          continue
        }

        tasks.push(async () => {
          const image = await this._fetchImage(
            () => this._fetchLcuAsset(iconPath),
            `lcu:${iconPath}`
          )

          if (!image) {
            return null
          }

          return { augmentId: augment.id, pixels: normalizeTemplate(image) }
        })
      }
    } catch (error) {
      this._logger.warn(`[augment-detect] LCU cherry augments unavailable: ${formatError(error)}`)
    }

    try {
      const kiwiAugments = await this._gtimg.getKiwiAugments()

      for (const augment of kiwiAugments) {
        if (!augment.small_Icon) {
          continue
        }

        const url = augment.small_Icon.startsWith('http')
          ? augment.small_Icon
          : `${GtimgApi.BASE_URL}${augment.small_Icon}`

        tasks.push(async () => {
          const image = await this._fetchImage(() => this._fetchHttpImage(url), url)

          if (!image) {
            return null
          }

          return { augmentId: augment.augmentID, pixels: normalizeTemplate(image) }
        })
      }
    } catch (error) {
      this._logger.warn(`[augment-detect] gtimg kiwi augments unavailable: ${formatError(error)}`)
    }

    const results = await mapWithConcurrency(tasks, FETCH_CONCURRENCY, (task) => task())
    const templates = results.filter((item): item is AugmentIconTemplate => item !== null)

    this._logger.info(`[augment-detect] built ${templates.length} augment icon templates`)

    if (templates.length === 0) {
      throw new Error('no augment icon templates were built')
    }

    return templates
  }

  private async _fetchImage(
    fetcher: () => Promise<Buffer>,
    label: string
  ): Promise<Electron.NativeImage | null> {
    try {
      const buffer = await fetcher()
      const image = Electron.NativeImage.createFromBuffer(buffer)

      if (image.isEmpty()) {
        return null
      }

      return image
    } catch (error) {
      this._logger.warn(`[augment-detect] failed to fetch icon ${label}: ${formatError(error)}`)
      return null
    }
  }

  private async _fetchLcuAsset(assetPath: string): Promise<Buffer> {
    const normalized = assetPath.startsWith('/') ? assetPath : `/${assetPath}`
    const response = await this._leagueClient.http.get(normalized, {
      responseType: 'arraybuffer'
    })

    return Buffer.from(response.data)
  }

  private async _fetchHttpImage(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': GtimgApi.USER_AGENT }
    })

    return Buffer.from(response.data)
  }
}

/**
 * 将图标归一化为 TEMPLATE_SIZE 见方的像素数据
 */
export function normalizeTemplate(image: Electron.NativeImage): Uint8Array {
  const resized = image.resize({ width: TEMPLATE_SIZE, height: TEMPLATE_SIZE })
  const bitmap = resized.toBitmap()
  const expected = TEMPLATE_SIZE * TEMPLATE_SIZE * 4

  if (bitmap.length < expected) {
    throw new Error(`unexpected bitmap size: ${bitmap.length}`)
  }

  return new Uint8Array(bitmap.buffer, bitmap.byteOffset, expected)
}

/**
 * 保存模板调试截图等调试数据
 */
export async function saveDebugDump(data: {
  image?: Electron.NativeImage
  payload: unknown
}): Promise<string | null> {
  try {
    const dir = path.join(app.getPath('userData'), 'augment-debug')
    await fs.mkdir(dir, { recursive: true })

    const timestamp = Date.now()
    let saved = timestamp.toString()

    if (data.image && !data.image.isEmpty()) {
      const pngPath = path.join(dir, `${timestamp}.png`)
      await fs.writeFile(pngPath, data.image.toPNG())
      saved = pngPath
    }

    const jsonPath = path.join(dir, `${timestamp}.json`)
    await fs.writeFile(jsonPath, JSON.stringify(data.payload, null, 2), 'utf8')

    return saved
  } catch {
    return null
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(runners)

  return results
}
