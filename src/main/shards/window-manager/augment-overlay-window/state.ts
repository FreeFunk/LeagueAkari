import { Rectangle } from 'electron'
import { makeAutoObservable, observableRef } from 'mobx'

export class AugmentOverlayWindowSettings {
  enabled: boolean = false

  pinned: boolean = true

  opacity: number = 0.95

  /**
   * 按住时临时取消鼠标穿透并可拖动窗口的热键
   */
  showShortcut: string | null = null

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

  constructor() {
    makeAutoObservable(this, {
      trackedBounds: observableRef
    })
  }
}
