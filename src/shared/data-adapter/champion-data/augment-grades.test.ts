import { describe, expect, it } from 'vitest'

import {
  computeAugmentGrade,
  getTopAugmentsPerTier,
  gradeAugmentsByTier,
  sortAugmentsByPerformance
} from './augment-grades'
import type { ChampionAugment } from './types'

function makeAugment(overrides: Partial<ChampionAugment> = {}): ChampionAugment {
  return {
    augmentId: 1,
    tier: 1,
    rank: null,
    rankChange: null,
    performanceScore: null,
    performance: {
      games: 100,
      wins: 50,
      winRate: 0.5,
      pickRate: 1,
      rank: null,
      averagePlacement: null,
      firstPlaceRate: null
    },
    popularity: null,
    bestChampionIds: [],
    ...overrides
  }
}

describe('computeAugmentGrade', () => {
  it.each([
    [0, 10, 'S'],
    [1, 10, 'S'],
    [2, 10, 'A'],
    [3, 10, 'A'],
    [4, 10, 'B'],
    [6, 10, 'C'],
    [7, 10, 'C'],
    [9, 10, 'C'],
    [0, 1, 'S']
  ] as const)('rank %i/%i -> %s', (index, total, expected) => {
    expect(computeAugmentGrade(index, total)).toBe(expected)
  })
})

describe('sortAugmentsByPerformance', () => {
  it('prefers performanceScore over winRate', () => {
    const sorted = sortAugmentsByPerformance([
      makeAugment({ augmentId: 1, performanceScore: 50 }),
      makeAugment({ augmentId: 2, performanceScore: 80 }),
      makeAugment({
        augmentId: 3,
        performance: {
          games: 1,
          wins: 1,
          winRate: 0.9,
          pickRate: 1,
          rank: null,
          averagePlacement: null,
          firstPlaceRate: null
        }
      })
    ])

    expect(sorted.map((a) => a.augmentId)).toEqual([2, 1, 3])
  })

  it('keeps original order for equal values', () => {
    const augments = [
      makeAugment({ augmentId: 1, performanceScore: 50 }),
      makeAugment({ augmentId: 2, performanceScore: 50 })
    ]

    expect(sortAugmentsByPerformance(augments).map((a) => a.augmentId)).toEqual([1, 2])
  })
})

describe('gradeAugmentsByTier', () => {
  it('groups by tier and grades within each group', () => {
    const groups = gradeAugmentsByTier([
      makeAugment({ augmentId: 1, tier: 1, performanceScore: 10 }),
      makeAugment({ augmentId: 2, tier: 1, performanceScore: 90 }),
      makeAugment({ augmentId: 3, tier: 1, performanceScore: 50 }),
      makeAugment({ augmentId: 4, tier: 8, performanceScore: 20 })
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].tier).toBe(1)
    expect(groups[0].items.map((item) => item.augment.augmentId)).toEqual([2, 3, 1])
    expect(groups[0].items.map((item) => item.grade)).toEqual(['S', 'A', 'C'])
    expect(groups[1].tier).toBe(8)
    expect(groups[1].items[0].grade).toBe('S')
  })

  it('separates unknown-tier augments into their own group', () => {
    const groups = gradeAugmentsByTier([
      makeAugment({ augmentId: 1, tier: null }),
      makeAugment({ augmentId: 2, tier: 4 })
    ])

    expect(groups.map((g) => g.tier)).toEqual([4, null])
    expect(groups[1].items).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(gradeAugmentsByTier([])).toEqual([])
  })
})

describe('getTopAugmentsPerTier', () => {
  it('limits each tier to topN items while keeping grades stable', () => {
    const augments = Array.from({ length: 8 }, (_, i) =>
      makeAugment({ augmentId: i + 1, tier: 4, performanceScore: 100 - i })
    )

    const groups = getTopAugmentsPerTier(augments, 5)

    expect(groups[0].items).toHaveLength(5)
    expect(groups[0].items.map((item) => item.augment.augmentId)).toEqual([1, 2, 3, 4, 5])
    expect(groups[0].items.map((item) => item.grade)).toEqual(['S', 'S', 'A', 'B', 'B'])
  })
})
