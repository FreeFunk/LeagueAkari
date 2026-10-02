<template>
  <div
    ref="wrapperEl"
    class="box-border flex w-full flex-col overflow-hidden rounded bg-[#1a1a1da0] p-1.5"
  >
    <SetupInAppScope />

    <template v-if="detectMode">
      <div class="flex w-full items-start justify-around gap-2">
        <div
          v-for="(card, index) in detectedCards"
          :key="index"
          class="flex min-w-0 flex-col items-center gap-1"
        >
          <AugmentDisplay :augment-id="card.augmentId ?? undefined" :size="44" class="shrink-0" />
          <span
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base leading-7 font-bold"
            :class="gradeClass(gradeOf(card))"
          >
            {{ gradeLabel(card) }}
          </span>
          <span class="max-w-40 truncate text-center text-xs font-bold text-white/95">
            {{ nameOf(card) }}
          </span>
          <span v-if="winRateOf(card) !== null" class="text-xs text-emerald-300 tabular-nums">
            {{ formatPercent(winRateOf(card)!) }}
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
import {
  getTopAugmentsPerTier,
  gradeAugmentsByTier
} from '@shared/data-adapter/champion-data/augment-grades'
import type {
  ChampionDataDetails,
  ChampionDataMode
} from '@shared/data-adapter/champion-data/types'
import { useInstance } from '@renderer-shared/shards'
import { SetupInAppScope } from '@renderer-shared/shards/setup-in-app-scope/setup-in-app-scope-component'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useAugmentOverlayWindowStore } from '@renderer-shared/shards/window-manager/store'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'
import { useElementSize } from '@vueuse/core'
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'

import type { AugmentGrade } from '@shared/data-adapter/champion-data/augment-grades'
import type { DetectedAugmentCard } from '@shared/shards/window-manager'

const wrapperEl = useTemplateRef('wrapperEl')
const { height, width } = useElementSize(wrapperEl)

const wm = useInstance(WindowManagerRenderer)
const logger = useInstance(LoggerRenderer)
const championData = useInstance(ChampionDataRenderer)
const lcs = useLeagueClientStore()
const aows = useAugmentOverlayWindowStore()
const resources = useAkariResourceProvider()

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
  return getTopAugmentsPerTier(augments, 3)
})

const gradeInfoById = computed(() => {
  const map = new Map<number, { grade: AugmentGrade; winRate: number | null }>()

  for (const group of gradeAugmentsByTier(details.value?.sections.augments ?? [])) {
    for (const item of group.items) {
      if (!map.has(item.augment.augmentId)) {
        map.set(item.augment.augmentId, {
          grade: item.grade,
          winRate: item.augment.performance.winRate
        })
      }
    }
  }

  return map
})

const detectedCards = computed(() => aows.detectedCards)
const detectMode = computed(() => (detectedCards.value?.length ?? 0) > 0)

function gradeOf(card: DetectedAugmentCard): AugmentGrade | null {
  if (card.augmentId === null) {
    return null
  }

  return gradeInfoById.value.get(card.augmentId)?.grade ?? null
}

function gradeLabel(card: DetectedAugmentCard): string {
  return gradeOf(card) ?? '?'
}

function nameOf(card: DetectedAugmentCard): string {
  if (card.augmentId === null) {
    return '?'
  }

  return resources.augments.name(card.augmentId)
}

function winRateOf(card: DetectedAugmentCard): number | null {
  if (card.augmentId === null) {
    return null
  }

  return gradeInfoById.value.get(card.augmentId)?.winRate ?? null
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`
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
      logger.warn('augment-overlay', 'loadRecommendations failed', error)
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

onMounted(() => {
  logger.info('augment-overlay', 'renderer mounted')

  window.addEventListener('error', (event) => {
    logger.error('augment-overlay', `renderer error: ${event.message}`)
  })
})

watch(
  [championDataMode, currentChampionId],
  ([mode, championId]) => {
    logger.info(
      'augment-overlay',
      `recommendation source updated: mode=${mode ?? 'none'}, championId=${championId ?? 'none'}`
    )
  },
  { immediate: true }
)

watch(
  () => aows.detectedCards,
  (cards) => {
    logger.info(
      'augment-overlay',
      `detected cards updated: ${JSON.stringify(
        cards?.map((card) => ({ id: card.augmentId, c: Number(card.confidence.toFixed(2)) })) ??
          null
      )}`
    )
  }
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
