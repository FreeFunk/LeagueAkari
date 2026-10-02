import { NATIVE_SUPPORT, isElevated } from '@main/native'
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
 * 截屏缩放比例 (相对全分辨率)
 */
const CAPTURE_SCALE = 0.5

/**
 * 连续未检出次数达到该值后隐藏悬浮条
 */
const MISS_STREAK_TO_HIDE = 3

/**
 * 连续命中次数达到该值后才显示悬浮条 (防止瞬时误判)
 */
const HIT_STREAK_TO_SHOW = 2

/**
 * 图标识别的最低置信度, 低于该值标记为"无法识别"
 */
const IDENTIFY_CONFIDENCE_THRESHOLD = 0.55

/**
 * 判定一次有效识别所需的最少可识别卡片数
 */
const MIN_IDENTIFIED_CARDS = 2

/**
 * 诊断转储的最小间隔 (ms)
 */
const GATES_DUMP_INTERVAL_MS = 15000

/**
 * 海克斯三卡图标槽位 (屏幕比例坐标), 基于 16:9 分辨率 + 默认 UI 缩放实测。
 * 卡片行: x [0.23, 0.77] 三等分, 图标位于卡片上部 y [0.24, 0.355]。
 * 若分辨率/UI 缩放不同导致偏差, 调整此处常量。
 */
const SLOT_BOXES: Array<{ x: number; y: number; width: number; height: number }> = [
  { x: 0.2775, y: 0.24, width: 0.065, height: 0.115 },
  { x: 0.4675, y: 0.24, width: 0.065, height: 0.115 },
  { x: 0.6575, y: 0.24, width: 0.065, height: 0.115 }
]

/**
 * 海克斯三卡自动识别控制器
 *
 * 在斗魂竞技场/海克斯大乱斗对局进行中周期性截屏, 对三个固定槽位
 * 截取图标区域并与本地海克斯图标模板做像素比对, 识别 augmentId。
 * 识别结果写入窗口 state, 由悬浮窗展示逐卡推荐。
 */
export class AugmentOverlayDetectController {
  private _timer: NodeJS.Timeout | null = null
  private _busy = false
  private _missStreak = MISS_STREAK_TO_HIDE
  private _hitStreak = 0
  private _gatesConfirmedLogged = false
  private _lastGatesDumpAt = 0

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

    this._missStreak = MISS_STREAK_TO_HIDE
    this._hitStreak = 0
    this._pushCleared()
  }

  private async _tick() {
    if (this._busy) {
      return
    }

    this._busy = true

    try {
      if (!NATIVE_SUPPORT.nativeInput.available || !this._deps.settings.autoDetect) {
        this._dumpGatesThrottled('native-or-settings')

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

      if (!this._gatesConfirmedLogged) {
        this._gatesConfirmedLogged = true
        this._deps.logger.info(
          `[augment-detect] detection active: gameMode=${gameMode}, phase=${session.phase}`
        )
      }

      const image = await this._capture(CAPTURE_SCALE)

      if (!image) {
        return this._handleMiss()
      }

      const templates = await this._deps.templates.ensureTemplates()

      if (templates.length === 0) {
        return this._handleMiss()
      }

      const cards = SLOT_BOXES.map((box) => this._identify(image, box, templates))
      const identified = cards.filter((card) => card.augmentId !== null).length

      if (identified < MIN_IDENTIFIED_CARDS) {
        this._dumpGatesThrottled('low-quality', { image, cards })

        return this._handleMiss()
      }

      this._missStreak = 0
      this._hitStreak++

      if (this._hitStreak < HIT_STREAK_TO_SHOW) {
        return
      }

      this._dumpDebug(image, cards, gameMode, 'recognized')
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
    this._hitStreak = 0
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
   * 截取主显示器画面, scale < 1 时返回缩放后的图像
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
   * 将槽位框截取的图标与模板库比对, 返回最匹配的海克斯
   */
  private _identify(
    image: Electron.NativeImage,
    box: { x: number; y: number; width: number; height: number },
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

  /**
   * 节流版诊断转储: 在支持的对局中无论识别是否成功都会记录
   * 门槛状态与截屏, 用于远程排查"什么都没发生"类问题
   */
  private _dumpGatesThrottled(
    stage: string,
    extra?: { image?: Electron.NativeImage; cards?: DetectedAugmentCard[] }
  ) {
    const now = Date.now()

    if (!this._deps.settings.debugDump || now - this._lastGatesDumpAt < GATES_DUMP_INTERVAL_MS) {
      return
    }

    this._lastGatesDumpAt = now

    const session = this._deps.leagueClient.data.gameflow.session

    void saveDebugDump({
      image: extra?.image,
      payload: {
        stage,
        capturedAt: new Date().toISOString(),
        nativeInputAvailable: NATIVE_SUPPORT.nativeInput.available,
        isElevated,
        enabled: this._deps.settings.enabled,
        autoDetect: this._deps.settings.autoDetect,
        phase: session?.phase ?? null,
        gameMode: session?.gameData.queue.gameMode ?? null,
        cards: extra?.cards ?? null
      }
    })
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
