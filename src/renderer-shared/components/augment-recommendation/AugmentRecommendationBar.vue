<template>
  <div class="flex flex-col gap-2 text-xs">
    <template v-if="loading">
      <div class="px-1 py-2 text-black/45 dark:text-white/45">
        {{ t('augmentOverlay.loading') }}
      </div>
    </template>

    <template v-else-if="groups.length === 0">
      <div class="flex flex-col items-start gap-1 px-1 py-2">
        <span class="text-black/45 dark:text-white/45">{{ t('augmentOverlay.noData') }}</span>
        <button
          class="cursor-pointer rounded bg-white/10 px-1.5 py-0.5 text-black/70 hover:bg-white/20 dark:text-white/70"
          type="button"
          @click="emit('retry')"
        >
          {{ t('augmentOverlay.retry') }}
        </button>
      </div>
    </template>

    <template v-else>
      <section v-for="group in groups" :key="group.tier ?? 'unknown'" class="flex flex-col gap-1">
        <div class="font-bold text-black/45 dark:text-white/45">
          {{ tierLabel(group.tier) }}
        </div>
        <div
          v-for="item in group.items"
          :key="item.augment.augmentId"
          class="flex items-center gap-1.5"
        >
          <AugmentDisplay :augment-id="item.augment.augmentId" :size="20" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            {{ resources.augments.name(item.augment.augmentId) }}
          </span>
          <span
            class="inline-flex w-4 shrink-0 items-center justify-center rounded-sm text-[10px] leading-4 font-bold"
            :class="gradeClass(item.grade)"
          >
            {{ item.grade }}
          </span>
          <span
            v-if="getWinRate(item.augment) != null"
            class="w-8 shrink-0 text-right text-black/45 tabular-nums dark:text-white/45"
          >
            {{ formatPercent(getWinRate(item.augment)!) }}
          </span>
        </div>
      </section>

      <div
        v-if="fakeShow"
        class="border-t border-white/10 px-1 pt-1 text-black/35 dark:text-white/35"
      >
        {{ t('augmentOverlay.hint') }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import AugmentDisplay from '@renderer-shared/components/widgets/AugmentDisplay.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useAugmentOverlayWindowStore } from '@renderer-shared/shards/window-manager/store'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'

import type {
  AugmentGrade,
  AugmentTierGroup
} from '@shared/data-adapter/champion-data/augment-grades'
import type { ChampionAugment } from '@shared/data-adapter/champion-data/types'

defineProps<{
  groups: AugmentTierGroup[]
  loading: boolean
}>()

const emit = defineEmits<{
  retry: []
}>()

const { t } = useTranslation()
const resources = useAkariResourceProvider()
const ogws = useAugmentOverlayWindowStore()

const fakeShow = computed(() => ogws.fakeShow)

function tierLabel(tier: number | null): string {
  if (tier === 1) return t('augmentOverlay.tier.silver')
  if (tier === 4) return t('augmentOverlay.tier.gold')
  if (tier === 8) return t('augmentOverlay.tier.prismatic')
  return t('augmentOverlay.tier.unknown')
}

function gradeClass(grade: AugmentGrade): string {
  switch (grade) {
    case 'S':
      return 'bg-amber-400/90 text-black'
    case 'A':
      return 'bg-green-500/80 text-white'
    case 'B':
      return 'bg-blue-500/80 text-white'
    default:
      return 'bg-black/25 text-white dark:bg-white/25'
  }
}

function getWinRate(augment: ChampionAugment): number | null {
  return augment.performance.winRate
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}
</script>
