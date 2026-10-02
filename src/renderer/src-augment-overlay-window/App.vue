<template>
  <div ref="wrapperEl" class="box-border w-fit flex-col overflow-hidden rounded bg-[#1a1a1da0] p-2">
    <SetupInAppScope />
    <AugmentRecommendationBar :groups="groups" :loading="isLoading" @retry="loadRecommendations" />
  </div>
</template>

<script setup lang="ts">
import AugmentRecommendationBar from '@renderer-shared/components/augment-recommendation/AugmentRecommendationBar.vue'
import { getTopAugmentsPerTier } from '@shared/data-adapter/champion-data/augment-grades'
import type {
  ChampionDataDetails,
  ChampionDataMode
} from '@shared/data-adapter/champion-data/types'
import { useInstance } from '@renderer-shared/shards'
import { SetupInAppScope } from '@renderer-shared/shards/setup-in-app-scope/setup-in-app-scope-component'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'
import { useElementSize } from '@vueuse/core'
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'

const wrapperEl = useTemplateRef('wrapperEl')
const { height, width } = useElementSize(wrapperEl)

const wm = useInstance(WindowManagerRenderer)
const logger = useInstance(LoggerRenderer)
const championData = useInstance(ChampionDataRenderer)
const lcs = useLeagueClientStore()

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
  return getTopAugmentsPerTier(augments, 5)
})

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

watch(
  [() => width.value, () => height.value],
  async ([width, height]) => {
    await wm.augmentOverlayWindow.setSize(Math.ceil(width), Math.ceil(height))
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
