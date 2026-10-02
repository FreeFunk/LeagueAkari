<template>
  <div
    ref="wrapperEl"
    class="box-border flex flex-col overflow-hidden rounded bg-[#1a1a1da0] p-1.5"
    :class="detectMode ? '' : 'w-fit'"
    :style="detectWrapperStyle"
  >
    <SetupInAppScope />

    <template v-if="detectMode">
      <div class="flex w-full items-start justify-around gap-1">
        <div
          v-for="(card, index) in detectedCards"
          :key="index"
          class="flex min-w-0 flex-col items-center gap-0.5"
        >
          <AugmentDisplay :augment-id="card.augmentId ?? undefined" :size="26" class="shrink-0" />
          <span
            class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-xs text-[10px] leading-4 font-bold"
            :class="gradeClass(gradeOf(card))"
          >
            {{ gradeLabel(card) }}
          </span>
        </div>
      </div>
    </template>

    <template v-else>
      <AugmentRecommendationBar
        :groups="groups"
        :loading="isLoading"
        @retry="loadRecommendations"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import AugmentRecommendationBar from '@renderer-shared/components/augment-recommendation/AugmentRecommendationBar.vue'
import AugmentDisplay from '@renderer-shared/components/widgets/AugmentDisplay.vue'
import { gradeAugmentsByTier } from '@shared/data-adapter/champion-data/augment-grades'
import type {
  ChampionDataDetails,
  ChampionDataMode
} from '@shared/data-adapter/champion-data/types'
import { useInstance } from '@renderer-shared/shards'
import { SetupInAppScope } from '@renderer-shared/shards/setup-in-app-scope/setup-in-app-scope-component'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { useAugmentOverlayWindowStore } from '@renderer-shared/shards/window-manager/store'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'
import { useElementSize } from '@vueuse/core'
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'

import type { AugmentGrade } from '@shared/data-adapter/champion-data/augment-grades'
import type { DetectedAugmentCard } from '@shared/shards/window-manager'

const wrapperEl = useTemplateRef('wrapperEl')
const { height, width } = useElementSize(wrapperEl)

const wm = useInstance(WindowManagerRenderer)
const logger = useInstance(LoggerRenderer)
const championData = useInstance(ChampionDataRenderer)
const lcs = useLeagueClientStore()
const aows = useAugmentOverlayWindowStore()

const GAME_MODE_TO_CHAMPION_DATA_MODE: Record<string, ChampionDataMode> = {
  CHERRY: 'arena',
  KIWI: 'aram_mayhem'
}

const details = shallowRef<ChampionDataDetails | null>(null)
const isLoading = ref(false)
let loadGeneration = 0

const currentGameMode = computed(() => {
  const session = lcs.gameflow.session
  if (!session || session.phase !== 'InProgress') {
    return null
  }

  return session.gameData.queue.gameMode
})

const championDataMode = computed(() => {
  const mode = currentGameMode.value
  return mode ? (GAME_MODE_TO_CHAMPION_DATA_MODE[mode] ?? null) : null
})

const currentChampionId = computed(() => {
  const selections = lcs.gameflow.session?.gameData.playerChampionSelections ?? []
  const selfSelection = selections.find((item) => item.puuid === lcs.summoner.me?.puuid)
  return selfSelection?.championId ?? null
})

const groups = computed(() => {
  const augments = details.value?.sections.augments ?? []
  return gradeAugmentsByTier(augments)
})

const gradeById = computed(() => {
  const map = new Map<number, AugmentGrade>()

  for (const group of groups.value) {
    for (const item of group.items) {
      if (!map.has(item.augment.augmentId)) {
        map.set(item.augment.augmentId, item.grade)
      }
    }
  }

  return map
})

const detectedCards = computed(() => aows.detectedCards)
const detectMode = computed(() => (detectedCards.value?.length ?? 0) > 0)

/**
 * 逐卡模式下窗口宽度对齐三卡行的宽度, 使推荐块与真实卡片逐一对齐
 */
const detectWrapperStyle = computed(() => {
  if (!detectMode.value) {
    return undefined
  }

  const cards = detectedCards.value ?? []
  const left = Math.min(...cards.map((card) => card.x))
  const right = Math.max(...cards.map((card) => card.x + card.width))

  return { width: `${Math.round((right - left) * window.screen.width)}px` }
})

function gradeOf(card: DetectedAugmentCard): AugmentGrade | null {
  if (card.augmentId === null) {
    return null
  }

  return gradeById.value.get(card.augmentId) ?? null
}

function gradeLabel(card: DetectedAugmentCard): string {
  return gradeOf(card) ?? '?'
}

function gradeClass(grade: AugmentGrade | null): string {
  switch (grade) {
    case 'S':
      return 'bg-amber-400/90 text-black'
    case 'A':
      return 'bg-green-500/80 text-white'
    case 'B':
      return 'bg-blue-500/80 text-white'
    case 'C':
      return 'bg-black/25 text-white dark:bg-white/25'
    default:
      return 'bg-black/40 text-white dark:bg-white/40'
  }
}

function loadRecommendations() {
  const mode = championDataMode.value
  const championId = currentChampionId.value

  if (!mode || !championId || championId <= 0) {
    loadGeneration++
    details.value = null
    isLoading.value = false
    return
  }

  const generation = ++loadGeneration
  isLoading.value = true

  championData
    .loadDetails({ mode }, championId)
    .then((result) => {
      if (generation !== loadGeneration) {
        return
      }

      details.value = result.status === 'success' ? result.data : null
    })
    .catch((error) => {
      if (generation !== loadGeneration) {
        return
      }

      details.value = null
      logger.warn('augment-overlay loadRecommendations failed', error)
    })
    .finally(() => {
      if (generation === loadGeneration) {
        isLoading.value = false
      }
    })
}

watch(
  [championDataMode, currentChampionId],
  () => {
    loadRecommendations()
  },
  { immediate: true }
)

let lastAppliedWidth = 0
let lastAppliedHeight = 0

watch(
  [() => width.value, () => height.value],
  async ([width, height]) => {
    // 逐卡标注模式下窗口尺寸由主进程按三卡位置决定, 避免形成尺寸反馈循环
    if (detectMode.value) {
      return
    }

    const nextWidth = Math.ceil(width)
    const nextHeight = Math.ceil(height)

    if (nextWidth === lastAppliedWidth && nextHeight === lastAppliedHeight) {
      return
    }

    lastAppliedWidth = nextWidth
    lastAppliedHeight = nextHeight

    await wm.augmentOverlayWindow.setSize(nextWidth, nextHeight)
  },
  {
    immediate: true
  }
)
</script>

<style>
html,
body,
#app {
  width: fit-content;
  height: fit-content;
}
</style>
