import { is } from '@electron-toolkit/utils'
import { NATIVE_SUPPORT } from '@main/native'
import { GameClientMain } from '@main/shards/game-client'
import icon from '@resources/LA_ICON.ico?asset&asarUnpack'
import type { DetectedAugmentCard } from '@shared/shards/window-manager'
import { screen } from 'electron'
import { compareShallow } from 'mobx'
import { z } from 'zod'

import { BaseAkariWindow } from '../base-akari-window'
import type { WindowManagerMainContext } from '../context'
import { AugmentOverlayDetectController } from './detect-controller'
import { AugmentDetectTemplateLoader } from './detect-template-loader'
import { AugmentOverlayWindowSettings, AugmentOverlayWindowState } from './state'

/**
 * 海克斯推荐悬浮条窗口
 *
 * 在斗魂竞技场(CHERRY)与海克斯大乱斗(KIWI)对局进行中, 将当前英雄的
 * 海克斯强化推荐以悬浮条形式显示在游戏画面上, 避免玩家切屏查看推荐。
 *
 * 默认鼠标穿透, 按住 showShortcut 热键时临时取消穿透以便拖动位置。
 */
export class AkariAugmentOverlayWindow extends BaseAkariWindow<
  AugmentOverlayWindowState,
  AugmentOverlayWindowSettings
> {
  static readonly NAMESPACE_SUFFIX = 'augment-overlay-window'
  static readonly HTML_ENTRY = 'augment-overlay-window.html'
  static readonly TITLE = 'Akari Augment Overlay'
  static readonly BASE_WIDTH = 240
  static readonly BASE_HEIGHT = 120

  public shortcutTargetId: string

  private _didDefaultPosition = false
  private _templates: AugmentDetectTemplateLoader
  private _detectController: AugmentOverlayDetectController

  private _applyOverlayWindowBehavior() {
    if (!this._window || this._window.isDestroyed()) {
      return
    }

    this._window.setSkipTaskbar(true)
    this._window.setAlwaysOnTop(true, 'screen-saver', 1)
  }

  /**
   * 无记忆位置时默认停靠主屏幕右侧居中, 避免遮挡游戏画面中心
   */
  private _applyDefaultPositionIfNotRemembered() {
    if (this._didDefaultPosition || this.state.trackedBounds || !this._window) {
      return
    }

    this._didDefaultPosition = true

    const workArea = screen.getPrimaryDisplay().workArea
    const [width, height] = this._window.getSize()
    const x = workArea.x + workArea.width - width - 48
    const y = workArea.y + Math.round((workArea.height - height) / 2)

    this._window.setPosition(x, y)
    this._logger.info(`Applied default position for ${this._namespace}`)
  }

  constructor(_context: WindowManagerMainContext) {
    const state = new AugmentOverlayWindowState()
    const settings = new AugmentOverlayWindowSettings()

    super(_context, AkariAugmentOverlayWindow.NAMESPACE_SUFFIX, state, settings, {
      baseWidth: AkariAugmentOverlayWindow.BASE_WIDTH,
      baseHeight: AkariAugmentOverlayWindow.BASE_HEIGHT,
      minWidth: 120,
      minHeight: 80,
      htmlEntry: AkariAugmentOverlayWindow.HTML_ENTRY,
      rememberPosition: true,
      rememberSize: false,
      repositionWindowIfInvisible: true,
      settingSchema: {
        pinned: {
          default: settings.pinned,
          schema: z.boolean(),
          transform: () => true
        },
        enabled: {
          default: settings.enabled,
          schema: z.boolean(),
          restore: ({ value }) =>
            NATIVE_SUPPORT.nativeInput.available ? (value as boolean) : false,
          transform: ({ value }) => NATIVE_SUPPORT.nativeInput.available && value
        },
        showShortcut: { default: settings.showShortcut, schema: z.string().nullable() },
        autoDetect: { default: settings.autoDetect, schema: z.boolean() },
        debugDump: { default: settings.debugDump, schema: z.boolean() }
      },
      browserWindowOptions: {
        title: AkariAugmentOverlayWindow.TITLE,
        icon: icon,
        show: false,
        frame: false,
        resizable: false,
        focusable: false,
        type: 'panel',
        alwaysOnTop: true,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        transparent: true,
        skipTaskbar: true,
        roundedCorners: false,
        hasShadow: false,
        autoHideMenuBar: true,
        backgroundColor: '#00000000',
        webPreferences: {
          backgroundThrottling: true
        },
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 8, y: 8 }
      }
    })

    this.shortcutTargetId = `${this._namespace}/show`

    this._templates = new AugmentDetectTemplateLoader(this._leagueClient, this._logger)
    this._detectController = new AugmentOverlayDetectController({
      leagueClient: this._leagueClient,
      settings: this.settings,
      state: this.state,
      templates: this._templates,
      logger: this._logger,
      onCardsDetected: (cards) => this._handleCardsDetected(cards),
      onCardsCleared: () => this._handleCardsCleared()
    })
  }

  /**
   * 识别到三卡后, 将悬浮窗自动定位到三卡上方并显示
   */
  private _handleCardsDetected(cards: DetectedAugmentCard[]) {
    if (!this._window) {
      return
    }

    const display = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = display.size
    const rowLeft = Math.min(...cards.map((card) => card.x)) * screenWidth
    const rowRight = Math.max(...cards.map((card) => card.x + card.width)) * screenWidth
    const rowTop = Math.min(...cards.map((card) => card.y)) * screenHeight

    const [windowWidth, windowHeight] = this._window.getSize()
    const workArea = display.workArea
    const x = Math.round(
      Math.min(
        Math.max(display.bounds.x + (rowLeft + rowRight) / 2 - windowWidth / 2, workArea.x),
        workArea.x + workArea.width - windowWidth
      )
    )
    const y = Math.round(Math.max(display.bounds.y + rowTop - windowHeight - 16, workArea.y))

    this._window.setPosition(x, y)
    this.show(true)
    this._applyOverlayWindowBehavior()

    if (!this.state.fakeShow) {
      this._window.setIgnoreMouseEvents(true)
    }
  }

  private _handleCardsCleared() {
    if (!this.state.fakeShow) {
      this.hide()
    }
  }

  private _watchDetectController() {
    this._mobxUtils.reaction(
      () => {
        const session = this._leagueClient.data.gameflow.session
        const gameMode = session?.gameData.queue.gameMode

        return [
          this.settings.enabled,
          this.settings.autoDetect,
          NATIVE_SUPPORT.nativeInput.available,
          this._windowManager.state.isManagerFinishedInit,
          session?.phase === 'InProgress' && (gameMode === 'CHERRY' || gameMode === 'KIWI')
        ]
      },
      ([enabled, autoDetect, native, finishedInit, inSupportedGame]) => {
        if (enabled && autoDetect && native && finishedInit && inSupportedGame) {
          this._detectController.start()
        } else {
          this._detectController.stop()
        }
      },
      { fireImmediately: true, equals: compareShallow, delay: 1000 }
    )
  }

  private _watchAugmentOverlayWindow() {
    if (!this.settings.pinned) {
      this._settingService.set('pinned', true)
    }

    this._mobxUtils.reaction(
      () => [this.settings.enabled, this._windowManager.state.isManagerFinishedInit],
      ([enabled, finishedInit]) => {
        if (!finishedInit) {
          return
        }

        if (enabled && NATIVE_SUPPORT.nativeInput.available) {
          this.createWindow()
        } else {
          this.close(true)
        }
      },
      {
        fireImmediately: true,
        equals: compareShallow,
        delay: 500
      }
    )

    this._mobxUtils.reaction(
      () => this.state.ready,
      (ready) => {
        if (!ready) {
          return
        }

        if (this._window) {
          this._window.setIgnoreMouseEvents(true)
          this._applyDefaultPositionIfNotRemembered()
        }
      }
    )

    this._mobxUtils.reaction(
      () => this.state.fakeShow,
      (fakeShow) => {
        if (fakeShow) {
          this._window?.setIgnoreMouseEvents(false)
        } else {
          this._window?.setIgnoreMouseEvents(true)
        }
      },
      { fireImmediately: true }
    )

    this._mobxUtils.reaction(
      () => this.settings.showShortcut,
      (shortcut) => {
        if (!shortcut) {
          this._logger.debug('Unregister augment-overlay window shortcut')
          this._keyboardShortcuts.unregisterByTargetId(this.shortcutTargetId)
          return
        }

        if (!NATIVE_SUPPORT.nativeInput.available) {
          return
        }

        try {
          this._keyboardShortcuts.register(
            this.shortcutTargetId,
            shortcut,
            'stateful',
            async (event) => {
              if (event.pressed) {
                if (!this.settings.enabled) {
                  return
                }

                if (is.dev || (await GameClientMain.isGameClientForeground())) {
                  this.show(true)
                  this._applyOverlayWindowBehavior()
                  this._window?.setIgnoreMouseEvents(false)
                  this.state.setFakeShow(true)
                }
              } else {
                this._window?.setIgnoreMouseEvents(true)
                this.state.setFakeShow(false)
                this.hide()
              }
            }
          )
        } catch {
          this._logger.warn('Failed to register augment-overlay window shortcut')
          this._settingService.set('showShortcut', null)
        }
      },
      { fireImmediately: true }
    )
  }

  override async onInit() {
    await super.onInit()

    if (!NATIVE_SUPPORT.nativeInput.available) {
      await this._settingService.set('enabled', false)
      return
    }

    this._watchAugmentOverlayWindow()
    this._watchDetectController()
  }

  protected override getStatePropKeys() {
    return ['fakeShow', 'detectedCards'] as const
  }

  protected override getSettingPropKeys() {
    return ['enabled', 'showShortcut', 'autoDetect', 'debugDump'] as const
  }
}
