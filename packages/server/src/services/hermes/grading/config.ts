/**
 * Grading Config — read/write the `grading` section of config.yaml.
 *
 * The existing /api/hermes/config endpoint already supports arbitrary
 * sections via ?section=grading (GET) and { section: "grading", values }
 * (PUT). This module provides TypeScript types and a helper with defaults.
 */

import { join } from 'path'
import { getActiveProfileName, getProfileDir } from '../hermes-profile'
import { safeFileStore } from '../../safe-file-store'

// ============================================================================
// Types
// ============================================================================

export interface RubricRules {
  objective_rules: string
  calculation_rules: string
  subjective_rules: string
  [key: string]: string
}

export interface GradingModelConfig {
  extract: string
  grade: string
  trend: string
}

export interface GradingPromptConfig {
  extract_template: string
  grade_student: string
  growth_summary: string
}

export interface GradingOutputConfig {
  auto_export_excel: boolean
  include_error_analysis: boolean
}

export interface GradingGrowthConfig {
  track_weak_points: boolean
  track_strengths: boolean
  trend_window: number
  auto_suggestion: boolean
}

export interface GradingConfig {
  provider: string
  baseUrl: string
  rootPath: string
  answerKeyword: string
  reportPrefix: string
  growthSuffix: string
  models: GradingModelConfig
  rubrics: Record<string, RubricRules>
  prompts: GradingPromptConfig
  output: GradingOutputConfig
  growth: GradingGrowthConfig
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: GradingConfig = {
  provider: 'deepseek',
  baseUrl: '',
  rootPath: './作业',
  answerKeyword: '答案',
  reportPrefix: '批改报告',
  growthSuffix: '_成长记录',

  models: {
    extract: 'qwen3-vl-plus',
    grade: 'qwen3-vl-plus',
    trend: 'qwen3-vl-235b-a22b',
  },

  rubrics: {
    default: {
      objective_rules: '选择题每题{score}分，答对满分答错0分',
      calculation_rules: '计算题：答案正确{score}分；过程对答案错得{partial}分',
      subjective_rules: '主观题：按要点给分，每个要点{score}分',
    },
  },

  prompts: {
    extract_template:
      '你是一位{subject}教师，请从以下答案图片中提取所有题目信息。对于每道题，请给出：题号、题型（选择题/填空题/计算题/简答题）、正确答案、分值。以 JSON 数组格式返回。',
    grade_student:
      '你是一位严格的{grade}{subject}教师，请根据答案模板批改以下学生作业。对每道题判断对错，给出得分，并简要评价。',
    growth_summary:
      '你是一位教育分析师，请根据以下学生的历史成绩记录，分析学习趋势、薄弱点和优势领域，并给出具体的学习建议。',
  },

  output: {
    auto_export_excel: true,
    include_error_analysis: true,
  },

  growth: {
    track_weak_points: true,
    track_strengths: true,
    trend_window: 10,
    auto_suggestion: true,
  },
}

// ============================================================================
// Helpers
// ============================================================================

function configPath(profile: string): string {
  return join(getProfileDir(profile), 'config.yaml')
}

function deepMergeDefaults(defaults: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...defaults }
  for (const key of Object.keys(overrides)) {
    const overrideVal = overrides[key]
    const defaultVal = defaults[key]
    if (
      overrideVal &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      defaultVal &&
      typeof defaultVal === 'object' &&
      !Array.isArray(defaultVal)
    ) {
      result[key] = deepMergeDefaults(defaultVal as Record<string, unknown>, overrideVal as Record<string, unknown>)
    } else {
      result[key] = overrideVal
    }
  }
  return result
}

/**
 * Read the grading config section with defaults applied.
 */
export async function getGradingConfig(profile?: string): Promise<GradingConfig> {
  const resolvedProfile = profile || getActiveProfileName() || 'default'
  try {
    const config = await safeFileStore.readYaml(configPath(resolvedProfile))
    const raw = config?.grading || {}
    return deepMergeDefaults(DEFAULT_CONFIG as unknown as Record<string, unknown>, raw) as unknown as GradingConfig
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * Merge partial grading config into config.yaml.
 */
export async function updateGradingConfig(
  partial: Partial<GradingConfig>,
  profile?: string,
): Promise<void> {
  const resolvedProfile = profile || getActiveProfileName() || 'default'
  await safeFileStore.updateYaml(
    configPath(resolvedProfile),
    (config) => {
      const existing = config?.grading || {}
      config.grading = deepMergeDefaults(existing, partial as unknown as Record<string, unknown>)
      return config
    },
    { backup: true, dumpOptions: { forceQuotes: true } },
  )
}

/**
 * Resolve a template string with variables.
 * Supported: {subject}, {grade}, {score}, {partial}
 */
export function resolvePrompt(template: string, vars: Record<string, string | number>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value))
  }
  return result
}
