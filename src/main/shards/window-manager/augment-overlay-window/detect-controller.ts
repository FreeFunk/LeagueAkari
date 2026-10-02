import { NATIVE_SUPPORT } from '@main/native'
import { GameClientMain } from '@main/shards/game-client'
import type { AkariLogger } from '@main/shards/logger-factory'
import type { DetectedAugmentCard } from '@shared/shards/window-manager'
import { desktopCapturer, screen } from 'electron'

import type { LeagueClientMain } from '../../league-client'
import {
  AugmentDetectTemplateLoader,
  type AugmentIconTemplate,
  TEMPLATE_SIZE,
  saveDebugDump
} from './detect-template-loader'
import type { AugmentOverlayWindowSettings, AugmentOverlayWindowState } from './state'

/**
 * 检测循环间隔 (ms)
 */
const TICK_MS = 600

/**
 * 预览截屏缩放比例, 用于廉价的弹卡检测
 */
const PREVIEW_SCALE = 0.35

/**
 * 连续未检出次数达到该值后隐藏悬浮条
 */
const MISS_STREAK_TO_HIDE = 3

/**
 * 图标识别的最低置信度, 低于该值标记为"无法识别"
 */
const IDENTIFY_CONFIDENCE_THRESHOLD = 0.55

/**
 * 判定一次有效识别所需的最少可识别卡片数
 */
const MIN_IDENTIFIED_CARDS = 2

// 搜索带范围 (屏幕比例坐标), 三卡图标只会出现在画面中下部
const SEARCH_BAND_X = [0.15, 0.85] as const
const SEARCH_BAND_Y = [0.4, 0.92] as const

// 图标候选框的尺寸约束 (相对屏幕短边的比例)
const ICON_MIN_WIDTH_RATIO = 0.025
const ICON_MAX_WIDTH_RATIO = 0.11

interface FractionalBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 海克斯三卡自动识别控制器
 *
 * 在斗魂竞技场/海克斯大乱斗对局进行中周期性截屏:
 * 1. 低分辨率预览截屏做廉价的"弹卡"检测 (图标色块扫描)
 * 2. 疑似弹出时做全分辨率截屏, 精确定位三个图标框
 * 3. 将图标框与本地海克斯图标模板做像素比对, 识别 augmentId
 * 4. 识别结果写入窗口 state, 由悬浮窗展示逐卡推荐
 */
export class AugmentOverlayDetectController {
  private _timer: NodeJS.Timeout | null = null
  private _busy = false
  private _missStreak = MISS_STREAK_TO_HIDE

  constructor(
    private readonly _deps: {
      leagueClient: LeagueClientMain
      settings: AugmentOverlayWindowSettings
      state: AugmentOverlayWindowState
      templates: AugmentDetectTemplateLoader
      logger: AkariLogger
      onCardsDetected: (cards: DetectedAugmentCard[]) => void
      onCardsCleared: () => void
    }
  ) {}

  start() {
    if (this._timer) {
      return
    }

    this._deps.logger.info('[augment-detect] detection loop started')
    this._timer = setInterval(() => {
      void this._tick()
    }, TICK_MS)
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
      this._deps.logger.info('[augment-detect] detection loop stopped')
    }

    this._pushCleared()
  }

  private async _tick() {
    if (this._busy) {
      return
    }

    this._busy = true

    try {
      if (!NATIVE_SUPPORT.nativeInput.available || !this._deps.settings.autoDetect) {
        return this._handleMiss()
      }

      if (!(await GameClientMain.isGameClientForeground())) {
        return this._handleMiss()
      }

      const session = this._deps.leagueClient.data.gameflow.session

      if (!session || session.phase !== 'InProgress') {
        return this._handleMiss()
      }

      const gameMode = session.gameData.queue.gameMode

      if (gameMode !== 'CHERRY' && gameMode !== 'KIWI') {
        return this._handleMiss()
      }

      // 廉价预览: 低分辨率下检测三卡是否弹出
      const preview = await this._capture(PREVIEW_SCALE)

      if (!preview || this._findIconBoxes(preview).length < 3) {
        return this._handleMiss()
      }

      // 疑似弹出: 全分辨率识别
      const full = await this._capture(1)

      if (!full) {
        return this._handleMiss()
      }

      const boxes = this._findIconBoxes(full)
      const row = pickCardRow(boxes)

      if (!row || row.length < 3) {
        return this._handleMiss()
      }

      const templates = await this._deps.templates.ensureTemplates()

      if (templates.length === 0) {
        return this._handleMiss()
      }

      const cards = row
        .slice(0, 3)
        .map((box) => this._identify(full, box, templates))
        .sort((a, b) => a.x - b.x)
      const identified = cards.filter((card) => card.augmentId !== null).length

      if (identified < MIN_IDENTIFIED_CARDS) {
        this._deps.logger.warn(
          `[augment-detect] low recognition quality: ${identified}/${cards.length}`
        )
        this._dumpDebug(full, cards, gameMode, 'low-quality')

        return this._handleMiss()
      }

      this._missStreak = 0
      this._dumpDebug(full, cards, gameMode, 'recognized')
      this._pushCards(cards)
    } catch (error) {
      this._deps.logger.warn(
        `[augment-detect] tick failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      this._busy = false
    }
  }

  private _handleMiss() {
    this._missStreak++

    if (this._missStreak >= MISS_STREAK_TO_HIDE) {
      this._pushCleared()
    }
  }

  private _pushCards(cards: DetectedAugmentCard[]) {
    const current = this._deps.state.detectedCards

    if (current && isSameCards(current, cards)) {
      return
    }

    this._deps.state.setDetectedCards(cards)
    this._deps.onCardsDetected(cards)
  }

  private _pushCleared() {
    if (this._deps.state.detectedCards) {
      this._deps.state.setDetectedCards(null)
      this._deps.onCardsCleared()
    }
  }

  /**
   * 截取主显示器画面, scale < 1 时返回缩放后的预览图
   */
  private async _capture(scale: number) {
    const display = screen.getPrimaryDisplay()
    const { width, height } = display.size
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
      }
    })

    if (sources.length === 0) {
      return null
    }

    const primary = sources.find((source) => source.display_id === String(display.id))

    return (primary ?? sources[0]).thumbnail
  }

  /**
   * 在截屏中定位海克斯图标候选框, 返回屏幕比例坐标
   */
  private _findIconBoxes(image: Electron.NativeImage): FractionalBox[] {
    const { width, height } = image.getSize()
    const bitmap = image.toBitmap()
    const bytesPerPixel = 4

    const bandXStart = Math.floor(width * SEARCH_BAND_X[0])
    const bandXEnd = Math.ceil(width * SEARCH_BAND_X[1])
    const bandYStart = Math.floor(height * SEARCH_BAND_Y[0])
    const bandYEnd = Math.ceil(height * SEARCH_BAND_Y[1])
    const bandRows = bandYEnd - bandYStart

    if (bandXEnd <= bandXStart || bandRows <= 0) {
      return []
    }

    // 逐列统计"图标像素"(鲜艳或明亮)数量
    const columnCounts = new Uint32Array(bandXEnd - bandXStart)
    const columnMask: Uint8Array[] = []

    for (let y = bandYStart; y < bandYEnd; y++) {
      const rowMask = new Uint8Array(bandXEnd - bandXStart)
      const rowOffset = y * width * bytesPerPixel

      for (let x = bandXStart; x < bandXEnd; x++) {
        const offset = rowOffset + x * bytesPerPixel
        const b = bitmap[offset]
        const g = bitmap[offset + 1]
        const r = bitmap[offset + 2]
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const saturation = max - min
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b

        if ((saturation > 40 && luminance > 60) || luminance > 190) {
          rowMask[x - bandXStart] = 1
          columnCounts[x - bandXStart]++
        }
      }

      columnMask.push(rowMask)
    }

    // 列聚类: 连续的"活跃列"组成一个候选块
    const activeThreshold = Math.max(2, Math.floor(bandRows * 0.05))
    const gapTolerance = Math.max(2, Math.floor(width * 0.01))
    const candidates: Array<{ x0: number; x1: number }> = []
    let runStart = -1
    let runEnd = -1

    for (let x = 0; x < columnCounts.length; x++) {
      if (columnCounts[x] >= activeThreshold) {
        if (runStart === -1) {
          runStart = x
        }

        runEnd = x
      } else if (runStart !== -1 && x - runEnd > gapTolerance) {
        candidates.push({ x0: runStart, x1: runEnd })
        runStart = -1
        runEnd = -1
      }
    }

    if (runStart !== -1) {
      candidates.push({ x0: runStart, x1: runEnd })
    }

    // 由列块推导图标框, 并按尺寸约束过滤
    const minIconWidth = width * ICON_MIN_WIDTH_RATIO
    const maxIconWidth = width * ICON_MAX_WIDTH_RATIO
    const boxes: FractionalBox[] = []

    for (const candidate of candidates) {
      const boxWidth = candidate.x1 - candidate.x0 + 1

      if (boxWidth < minIconWidth || boxWidth > maxIconWidth) {
        continue
      }

      let y0 = -1
      let y1 = -1

      for (let i = 0; i < columnMask.length; i++) {
        const rowMask = columnMask[i]

        for (let x = candidate.x0; x <= candidate.x1; x++) {
          if (rowMask[x - bandXStart]) {
            if (y0 === -1) {
              y0 = i
            }

            y1 = i
            break
          }
        }
      }

      if (y0 === -1) {
        continue
      }

      const boxHeight = y1 - y0 + 1
      const aspect = boxWidth / boxHeight

      if (aspect < 0.5 || aspect > 2.0 || boxHeight > boxWidth * 3) {
        continue
      }

      boxes.push({
        x: (candidate.x0 + bandXStart) / width,
        y: (y0 + bandYStart) / height,
        width: boxWidth / width,
        height: boxHeight / height
      })
    }

    return boxes
  }

  /**
   * 将图标框与模板库比对, 返回最匹配的海克斯
   */
  private _identify(
    image: Electron.NativeImage,
    box: FractionalBox,
    templates: AugmentIconTemplate[]
  ): DetectedAugmentCard {
    const { width, height } = image.getSize()
    const cropX = Math.round(box.x * width)
    const cropY = Math.round(box.y * height)
    const cropWidth = Math.max(1, Math.round(box.width * width))
    const cropHeight = Math.max(1, Math.round(box.height * height))

    const cropped = image.crop({
      x: cropX,
      y: cropY,
      width: Math.min(cropWidth, width - cropX),
      height: Math.min(cropHeight, height - cropY)
    })
    const resized = cropped.resize({ width: TEMPLATE_SIZE, height: TEMPLATE_SIZE })
    const bitmap = resized.toBitmap()
    const pixels = new Uint8Array(
      bitmap.buffer,
      bitmap.byteOffset,
      TEMPLATE_SIZE * TEMPLATE_SIZE * 4
    )

    let bestId: number | null = null
    let bestDiff = Number.POSITIVE_INFINITY

    for (const template of templates) {
      let diff = 0

      for (let i = 0; i < pixels.length; i += 4) {
        diff += Math.abs(pixels[i] - template.pixels[i])
        diff += Math.abs(pixels[i + 1] - template.pixels[i + 1])
        diff += Math.abs(pixels[i + 2] - template.pixels[i + 2])
      }

      if (diff < bestDiff) {
        bestDiff = diff
        bestId = template.augmentId
      }
    }

    const maxDiff = TEMPLATE_SIZE * TEMPLATE_SIZE * 3 * 255
    const confidence = Math.max(0, 1 - bestDiff / maxDiff)

    return {
      augmentId: confidence >= IDENTIFY_CONFIDENCE_THRESHOLD ? bestId : null,
      confidence,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height
    }
  }

  private _dumpDebug(
    image: Electron.NativeImage,
    cards: DetectedAugmentCard[],
    gameMode: string,
    stage: string
  ) {
    if (!this._deps.settings.debugDump) {
      return
    }

    void saveDebugDump({
      image,
      payload: { gameMode, stage, cards, capturedAt: new Date().toISOString() }
    })
  }
}

/**
 * 从候选框中挑选最可能是"三卡一行"的组合
 */
function pickCardRow(boxes: FractionalBox[]): FractionalBox[] | null {
  if (boxes.length < 3) {
    return null
  }

  let best: FractionalBox[] | null = null

  for (let i = 0; i < boxes.length; i++) {
    const row = [boxes[i]]

    for (let j = i + 1; j < boxes.length; j++) {
      if (isSameRow(boxes[i], boxes[j])) {
        row.push(boxes[j])
      }
    }

    if (row.length >= 3 && (best === null || rowTotalWidth(row) > rowTotalWidth(best))) {
      best = row.sort((a, b) => a.x - b.x)
    }
  }

  return best
}

function isSameRow(a: FractionalBox, b: FractionalBox): boolean {
  const aCenter = a.y + a.height / 2
  const bCenter = b.y + b.height / 2
  const tolerance = Math.max(a.height, b.height) * 0.8

  return Math.abs(aCenter - bCenter) <= tolerance && Math.abs(a.width - b.width) <= a.width * 0.8
}

function rowTotalWidth(row: FractionalBox[]): number {
  return row.reduce((sum, box) => sum + box.width, 0)
}

function isSameCards(a: DetectedAugmentCard[], b: DetectedAugmentCard[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((card, index) => {
    const other = b[index]

    return (
      card.augmentId === other.augmentId &&
      Math.abs(card.x - other.x) < 0.01 &&
      Math.abs(card.y - other.y) < 0.01
    )
  })
}
