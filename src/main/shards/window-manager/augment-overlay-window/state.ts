import type { DetectedAugmentCard } from '@shared/shards/window-manager'
import { Rectangle } from 'electron'
import { makeAutoObservable, observableRef } from 'mobx'

export class AugmentOverlayWindowSettings {
  enabled: boolean = false

  pinned: boolean = true

  /**
   * 固定为 1: Electron 在部分环境下设置非 1 不透明度会导致窗口完全不可见
   * (参考 https://github.com/electron/electron/issues/45730)
   */
  opacity: number = 1

  /**
   * 按住时临时取消鼠标穿透并可拖动窗口的热键
   */
  showShortcut: string | null = null

  /**
   * 自动识别游戏内海克斯三卡并展示推荐
   */
  autoDetect: boolean = true

  /**
   * 识别调试: 保存截屏与识别结果到 userData/augment-debug
   */
  debugDump: boolean = false

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  setPinned(pinned: boolean) {
    this.pinned = pinned
  }

  setOpacity(opacity: number) {
    this.opacity = opacity
  }

  setShowShortcut(showShortcut: string | null) {
    this.showShortcut = showShortcut
  }

  setAutoDetect(autoDetect: boolean) {
    this.autoDetect = autoDetect
  }

  setDebugDump(debugDump: boolean) {
    this.debugDump = debugDump
  }

  constructor() {
    makeAutoObservable(this)
  }
}

export class AugmentOverlayWindowState {
  status: 'normal' | 'maximized' | 'minimized' = 'normal'

  focus: 'focused' | 'blurred' = 'focused'

  ready: boolean = false

  show: boolean = true

  trackedBounds: Rectangle | null = null

  /**
   * 按住热键时的临时交互状态, 用于拖动窗口位置
   */
  fakeShow: boolean = false

  /**
   * 最近一次自动识别到的海克斯三卡, null 表示当前无识别结果
   */
  detectedCards: DetectedAugmentCard[] | null = null

  setStatus(status: 'normal' | 'maximized' | 'minimized') {
    this.status = status
  }

  setReady(ready: boolean) {
    this.ready = ready
  }

  setShow(show: boolean) {
    this.show = show
  }

  setTrackedBounds(bounds: Rectangle | null) {
    this.trackedBounds = bounds
  }

  setFakeShow(fakeShow: boolean) {
    this.fakeShow = fakeShow
  }

  setDetectedCards(detectedCards: DetectedAugmentCard[] | null) {
    this.detectedCards = detectedCards
  }

  constructor() {
    makeAutoObservable(this, {
      trackedBounds: observableRef,
      detectedCards: observableRef
    })
  }
}
