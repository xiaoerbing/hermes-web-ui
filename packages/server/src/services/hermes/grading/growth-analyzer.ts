/**
 * Growth Analyzer — read historical growth records, analyze trends,
 * and generate learning suggestions using the trend model.
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import { callQwenVLWithRetry } from './grader'
import { getGradingConfig, resolvePrompt } from './config'
import { listResultsByStudent, listResultsByAssignment } from '../../../db/hermes/grading-store'
import type { GradingResult } from '../../../db/hermes/grading-store'

export interface GrowthTrend {
  subject: string
  scores: number[]
  trend: 'up' | 'down' | 'stable'
  weakPoints: string[]
  strengths: string[]
  suggestion: string
}

export interface GrowthAnalysis {
  studentName: string
  className: string
  records: Array<{ assignmentName: string; date: string; subject: string; score: number; total: number }>
  trends: GrowthTrend[]
  overallSuggestion: string
}

/**
 * Parse a growth record MD file into structured data.
 */
function parseGrowthRecord(content: string): Array<{
  assignmentName: string; date: string; subject: string; score: number; total: number
}> {
  const records: Array<{ assignmentName: string; date: string; subject: string; score: number; total: number }> = []
  const sections = content.split(/\n## /)

  for (const section of sections) {
    // Match: "assignmentName (YYYY-MM-DD)"
    const headerMatch = section.match(/^(.+?)\s*\((\d{4}-\d{2}-\d{2})\)/)
    if (!headerMatch) continue

    const assignmentName = headerMatch[1].trim()
    const date = headerMatch[2]

    const subjectMatch = section.match(/\*\*学科\*\*:\s*(.+)/)
    const scoreMatch = section.match(/\*\*得分\*\*:\s*([\d.]+)\/([\d.]+)/)

    if (scoreMatch) {
      records.push({
        assignmentName, date,
        subject: subjectMatch ? subjectMatch[1].trim() : '',
        score: parseFloat(scoreMatch[1]),
        total: parseFloat(scoreMatch[2]),
      })
    }
  }

  return records
}

/**
 * Analyze a student's growth across all subjects using historical DB data.
 */
export async function analyzeStudentGrowth(
  studentName: string,
  classNames: string[],
): Promise<GrowthAnalysis> {
  const config = await getGradingConfig()
  const results = listResultsByStudent(classNames, studentName)

  const records = results.map(r => {
    const assignment = (r as any).dir_name || ''
    return {
      assignmentName: assignment,
      date: new Date(r.created_at).toISOString().slice(0, 10),
      subject: (r as any).subject || '',
      score: r.score,
      total: r.total,
    }
  })

  // Group by subject
  const bySubject = new Map<string, typeof records>()
  for (const r of records) {
    if (!bySubject.has(r.subject)) bySubject.set(r.subject, [])
    bySubject.get(r.subject)!.push(r)
  }

  // Compute trends per subject
  const trends: GrowthTrend[] = []
  for (const [subject, subjectRecords] of bySubject) {
    const recentRecords = subjectRecords.slice(-config.growth.trend_window)
    const scores = recentRecords.map(r => r.total > 0 ? Math.round((r.score / r.total) * 100) : 0)

    let trend: 'up' | 'down' | 'stable' = 'stable'
    if (scores.length >= 2) {
      const firstHalf = scores.slice(0, Math.floor(scores.length / 2))
      const secondHalf = scores.slice(Math.floor(scores.length / 2))
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
      if (secondAvg - firstAvg > 5) trend = 'up'
      else if (firstAvg - secondAvg > 5) trend = 'down'
    }

    // Collect weak points and strengths from error_analysis
    const weakPoints: string[] = []
    const strengths: string[] = []
    for (const r of results) {
      if (r.error_analysis) {
        try {
          const analysis = JSON.parse(r.error_analysis) as Record<string, unknown>
          if (Array.isArray(analysis.weak_points)) weakPoints.push(...analysis.weak_points as string[])
          if (Array.isArray(analysis.strengths)) strengths.push(...analysis.strengths as string[])
        } catch { /* skip */ }
      }
    }

    // If config enabled, call trend model for suggestions
    let suggestion = ''
    if (config.growth.auto_suggestion && scores.length >= 2) {
      try {
        const prompt = resolvePrompt(config.prompts.growth_summary, { subject })
        const analysisPrompt = `${prompt}\n\n学生: ${studentName}\n学科: ${subject}\n历史成绩(%): ${scores.join('→')}\n趋势: ${trend}\n薄弱点: ${weakPoints.join('、') || '未知'}`
        const raw = await callQwenVLWithRetry([], analysisPrompt, { model: config.models.trend, maxRetries: 1 })
        suggestion = String(raw.suggestion || raw.overall_comment || raw.advice || '').slice(0, 300)
      } catch {
        suggestion = trend === 'up' ? '继续保持良好学习习惯' : trend === 'down' ? '需加强复习和练习' : '成绩稳定，继续保持'
      }
    }

    trends.push({ subject, scores, trend, weakPoints: [...new Set(weakPoints)], strengths: [...new Set(strengths)], suggestion })
  }

  const overallSuggestion = trends.map(t => `${t.subject}: ${t.suggestion}`).join('；')

  return { studentName, className: classNames[0] || '', records, trends, overallSuggestion }
}

/**
 * Parse and analyze growth from an existing MD record file.
 */
export async function analyzeGrowthFromFile(recordPath: string): Promise<{
  records: Array<{ assignmentName: string; date: string; subject: string; score: number; total: number }>
}> {
  try {
    const content = await readFile(recordPath, 'utf-8')
    return { records: parseGrowthRecord(content) }
  } catch {
    return { records: [] }
  }
}
