/**
 * Report Writer — generate grading summary report and update
 * per-student growth records in the file system.
 */

import { writeFile, readFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { getGradingConfig } from './config'
import { listResultsByAssignment, getAssignmentStats, getAssignment } from '../../../db/hermes/grading-store'
import type { StudentGradeResult } from './batch-grader'
import type { AnswerTemplate } from './template-extractor'

export async function writeAssignmentReport(
  assignmentDir: string,
  assignmentName: string,
  subject: string,
  template: AnswerTemplate,
  results: StudentGradeResult[],
): Promise<string> {
  const config = await getGradingConfig()
  const reportPath = join(assignmentDir, `${config.reportPrefix}_${assignmentName}.md`)

  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const stats = computeStats(results, template.totalScore)

  // Build report
  const lines: string[] = [
    `# ${assignmentName} — 批改报告`,
    '',
    `**批改时间**: ${dateStr}`,
    `**学科**: ${subject}`,
    `**满分**: ${template.totalScore}分`,
    `**学生数**: ${results.length}`,
    `**平均分**: ${stats.avgScore}`,
    `**最高分**: ${stats.maxScore}`,
    `**最低分**: ${stats.minScore}`,
    `**及格率**: ${stats.passRate}%`,
    '',
    '## 成绩表',
    '',
    '| 学生 | 得分 | 正确率 | 错题数 | 评价 |',
    '|------|------|--------|--------|------|',
  ]

  for (const r of results) {
    const correctRate = r.total > 0 ? Math.round((r.correctCount / r.questionCount) * 1000) / 10 : 0
    const wrongCount = r.questionCount - r.correctCount
    lines.push(`| ${r.studentName} | ${r.score} | ${correctRate}% | ${wrongCount} | ${r.evaluation} |`)
  }

  // Error analysis
  lines.push('', '## 常见错题', '')
  const errorMap = new Map<string, Array<{ student: string; answer: string; reason: string }>>()
  for (const r of results) {
    for (const d of r.details) {
      if (!d.isCorrect) {
        if (!errorMap.has(d.qid)) errorMap.set(d.qid, [])
        errorMap.get(d.qid)!.push({ student: r.studentName, answer: d.studentAnswer, reason: d.wrongType || d.comment })
      }
    }
  }

  for (const [qid, errors] of errorMap) {
    lines.push(`- **第${qid}题**: ${errors.length}人错`)
    for (const e of errors) {
      lines.push(`  - ${e.student}: \`${e.answer}\` (${e.reason})`)
    }
  }

  await writeFile(reportPath, lines.join('\n'), 'utf-8')
  return reportPath
}

function computeStats(results: StudentGradeResult[], totalScore: number) {
  if (results.length === 0) return { avgScore: 0, maxScore: 0, minScore: 0, passRate: 0 }
  const scores = results.map(r => r.score)
  const passCount = scores.filter(s => totalScore > 0 && (s / totalScore) >= 0.6).length
  return {
    avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
    maxScore: Math.max(...scores),
    minScore: Math.min(...scores),
    passRate: Math.round((passCount / results.length) * 10000) / 100,
  }
}

// ============================================================================
// Growth Record
// ============================================================================

export async function updateGrowthRecord(
  classDir: string,
  studentName: string,
  className: string,
  assignmentName: string,
  subject: string,
  result: StudentGradeResult,
  template: AnswerTemplate,
): Promise<string> {
  const config = await getGradingConfig()
  const recordPath = join(classDir, `${studentName}${config.growthSuffix}.md`)
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const newSection = buildGrowthSection(studentName, className, assignmentName, subject, dateStr, result, template)

  let existing = ''
  try {
    existing = await readFile(recordPath, 'utf-8')
  } catch {
    // File doesn't exist yet — create header
    existing = [
      `# ${studentName} — 学习成长记录`,
      '',
      `**班级**: ${className}`,
      `**首次记录**: ${dateStr}`,
      '',
    ].join('\n')
  }

  // Remove old trend analysis section if present
  const trendMarker = '\n---\n\n## 综合趋势分析'
  const trendIdx = existing.indexOf(trendMarker)
  const baseContent = trendIdx >= 0 ? existing.slice(0, trendIdx) : existing

  // Append new section
  const updated = baseContent + '\n---\n\n' + newSection + '\n'

  await mkdir(dirname(recordPath), { recursive: true })
  await writeFile(recordPath, updated, 'utf-8')
  return recordPath
}

function buildGrowthSection(
  studentName: string, className: string, assignmentName: string,
  subject: string, dateStr: string,
  result: StudentGradeResult, template: AnswerTemplate,
): string {
  const correctRate = result.questionCount > 0
    ? Math.round((result.correctCount / result.questionCount) * 1000) / 10 : 0

  const wrongDetails = result.details.filter(d => !d.isCorrect)
  const wrongTable = wrongDetails.length > 0
    ? [
        '',
        '| 题号 | 题型 | 学生答案 | 正确答案 | 失分 |',
        '|------|------|----------|----------|------|',
        ...wrongDetails.map(d => {
          const tq = template.questions.find(q => q.qid === d.qid)
          return `| ${d.qid} | ${tq?.type || ''} | ${d.studentAnswer} | ${d.correctAnswer} | ${d.maxScore - d.score} |`
        }),
      ].join('\n')
    : '\n（全部正确）'

  const weakPoints = wrongDetails
    .map(d => d.wrongType)
    .filter((v): v is string => !!v)
    .filter((v, i, arr) => arr.indexOf(v) === i)

  const strengths = result.details
    .filter(d => d.isCorrect)
    .slice(0, 3)
    .map(d => `第${d.qid}题`)
    .join('、')

  return [
    `## ${assignmentName} (${dateStr})`,
    '',
    `- **学科**: ${subject}`,
    `- **得分**: ${result.score}/${result.total} (${correctRate}%)`,
    `- **正确率**: ${result.correctCount}/${result.questionCount}`,
    `- **错题**:`,
    wrongTable,
    `- **薄弱点**: ${weakPoints.length > 0 ? weakPoints.join('、') : '无'}`,
    `- **进步点**: ${strengths || '全部掌握'}`,
    `- **教师评语**: ${result.evaluation}`,
    '',
  ].join('\n')
}
