import type { ChampionAugment } from './types'

export type AugmentGrade = 'S' | 'A' | 'B' | 'C'

export interface GradedAugment {
  augment: ChampionAugment
  grade: AugmentGrade
}

export interface AugmentTierGroup {
  /**
   * 海克斯档位, 1=银 / 4=金 / 8=棱彩, null 表示数据源未提供档位
   */
  tier: number | null
  items: GradedAugment[]
}

/**
 * 未提供档位的海克斯在分组时使用的键
 */
const UNKNOWN_TIER_KEY = '__unknown__'

function getPerformanceValue(augment: ChampionAugment): number {
  if (augment.performanceScore != null) {
    return augment.performanceScore
  }

  return augment.performance.winRate ?? -Infinity
}

/**
 * 按推荐表现降序排列
 */
export function sortAugmentsByPerformance(augments: ChampionAugment[]): ChampionAugment[] {
  return [...augments].sort((a, b) => getPerformanceValue(b) - getPerformanceValue(a))
}

/**
 * 依据档位内排名计算推荐等级:
 * S = 前 15% / A = 15%~35% / B = 35%~60% / C = 其余
 *
 * @param index 0 起的排名
 * @param total 参与排名的总数, 必须大于 0
 */
export function computeAugmentGrade(index: number, total: number): AugmentGrade {
  const percentile = index / total

  if (percentile < 0.15) {
    return 'S'
  }

  if (percentile < 0.35) {
    return 'A'
  }

  if (percentile < 0.6) {
    return 'B'
  }

  return 'C'
}

/**
 * 将英雄的海克斯推荐按档位分组, 并在组内标注推荐等级。
 * tier 为 null 的数据归入独立的未分档组。
 */
export function gradeAugmentsByTier(augments: ChampionAugment[]): AugmentTierGroup[] {
  const grouped = new Map<string, ChampionAugment[]>()

  for (const augment of augments) {
    const key = augment.tier == null ? UNKNOWN_TIER_KEY : String(augment.tier)
    const bucket = grouped.get(key)

    if (bucket) {
      bucket.push(augment)
    } else {
      grouped.set(key, [augment])
    }
  }

  const groups: AugmentTierGroup[] = []

  for (const [key, bucket] of grouped) {
    const sorted = sortAugmentsByPerformance(bucket)
    const items = sorted.map((augment, index) => ({
      augment,
      grade: computeAugmentGrade(index, sorted.length)
    }))

    groups.push({
      tier: key === UNKNOWN_TIER_KEY ? null : Number(key),
      items
    })
  }

  return groups.sort((a, b) => (a.tier ?? Infinity) - (b.tier ?? Infinity))
}

/**
 * 取每个档位内排名前 N 的推荐, 用于悬浮条展示
 */
export function getTopAugmentsPerTier(
  augments: ChampionAugment[],
  topN: number = 5
): AugmentTierGroup[] {
  return gradeAugmentsByTier(augments).map((group) => ({
    ...group,
    items: group.items.slice(0, topN)
  }))
}
