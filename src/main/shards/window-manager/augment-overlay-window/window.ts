import { is } from '@electron-toolkit/utils'
import { NATIVE_SUPPORT } from '@main/native'
import { GameClientMain } from '@main/shards/game-client'
import icon from '@resources/LA_ICON.ico?asset&asarUnpack'
import { compareShallow, computed } from 'mobx'
import { z } from 'zod'

import { BaseAkariWindow } from '../base-akari-window'
import type { WindowManagerMainContext } from '../context'
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
  static readonly BASE_WIDTH = 260
  static readonly BASE_HEIGHT = 320

  /**
   * 支持海克斯强化的游戏模式
   */
  static readonly SUPPORTED_GAME_MODES = ['CHERRY', 'KIWI'] as const

  public shortcutTargetId: string

  private _applyOverlayWindowBehavior() {
    if (!this._window || this._window.isDestroyed()) {
      return
    }

    this._window.setSkipTaskbar(true)
    this._window.setAlwaysOnTop(true, 'screen-saver', 1)
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
        showShortcut: { default: settings.showShortcut, schema: z.string().nullable() }
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

    const shouldShowInGame = computed(() => {
      if (!NATIVE_SUPPORT.nativeInput.available || !this.state.ready || !this.settings.enabled) {
        return false
      }

      const session = this._leagueClient.data.gameflow.session

      if (
        session &&
        session.phase === 'InProgress' &&
        AkariAugmentOverlayWindow.SUPPORTED_GAME_MODES.includes(
          session.gameData.queue
            .gameMode as (typeof AkariAugmentOverlayWindow.SUPPORTED_GAME_MODES)[number]
        )
      ) {
        return true
      }

      return false
    })

    this._mobxUtils.reaction(
      () => shouldShowInGame.get(),
      (should) => {
        if (should) {
          this.show(true)
          this._applyOverlayWindowBehavior()
        } else {
          this.hide()
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
                if (is.dev || (await GameClientMain.isGameClientForeground())) {
                  if (!this.state.show) {
                    this.show()
                  }

                  this._window?.setIgnoreMouseEvents(false)
                  this.state.setFakeShow(true)
                }
              } else {
                this._window?.setIgnoreMouseEvents(true)
                this.state.setFakeShow(false)
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
  }

  protected override getStatePropKeys() {
    return ['fakeShow'] as const
  }

  protected override getSettingPropKeys() {
    return ['enabled', 'showShortcut'] as const
  }
}
