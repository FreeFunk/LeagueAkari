<template>
  <div class="flex flex-col gap-1 text-xs">
    <template v-if="loading">
      <div class="px-1 py-1 text-black/45 dark:text-white/45">
        {{ t('augmentOverlay.loading') }}
      </div>
    </template>

    <template v-else-if="groups.length === 0">
      <div class="flex items-center gap-1.5 px-1 py-1">
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
      <div v-for="group in groups" :key="group.tier ?? 'unknown'" class="flex items-center gap-1.5">
        <span class="w-7 shrink-0 text-right font-bold" :class="tierTextClass(group.tier)">
          {{ tierLabel(group.tier) }}
        </span>
        <div
          v-for="item in group.items"
          :key="item.augment.augmentId"
          class="flex items-center gap-0.5"
        >
          <AugmentDisplay :augment-id="item.augment.augmentId" :size="22" class="shrink-0" />
          <span
            class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-xs text-[9px] leading-3 font-bold"
            :class="gradeClass(item.grade)"
          >
            {{ item.grade }}
          </span>
        </div>
      </div>

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
import { useAugmentOverlayWindowStore } from '@renderer-shared/shards/window-manager/store'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'

import type {
  AugmentGrade,
  AugmentTierGroup
} from '@shared/data-adapter/champion-data/augment-grades'

defineProps<{
  groups: AugmentTierGroup[]
  loading: boolean
}>()

const emit = defineEmits<{
  retry: []
}>()

const { t } = useTranslation()
const ogws = useAugmentOverlayWindowStore()

const fakeShow = computed(() => ogws.fakeShow)

function tierLabel(tier: number | null): string {
  if (tier === 1) return t('augmentOverlay.tier.silver')
  if (tier === 4) return t('augmentOverlay.tier.gold')
  if (tier === 8) return t('augmentOverlay.tier.prismatic')
  return t('augmentOverlay.tier.unknown')
}

function tierTextClass(tier: number | null): string {
  if (tier === 1) return 'text-slate-400!'
  if (tier === 4) return 'text-amber-400!'
  if (tier === 8) return 'text-fuchsia-400!'
  return ''
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
</script>
