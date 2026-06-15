/**
 * Batch Grader — iterate through all students in an assignment,
 * grade each one, push progress events, and persist results.
 */

import { EventEmitter } from 'events'
import { callQwenVLWithRetry } from './grader'
import { getGradingConfig, resolvePrompt } from './config'
import { createResult, updateAssignmentStatus } from '../../../db/hermes/grading-store'
import type { AnswerTemplate, AnswerQuestion } from './template-extractor'
import type { ScannedStudent } from './scanner'

export interface GradingProgress {
  assignmentId: number
  current: number
  total: number
  studentName: string
  status: 'grading' | 'done' | 'error'
  error?: string
}

export interface StudentGradeResult {
  studentName: string
  imagePaths: string[]
  score: number
  total: number
  correctCount: number
  questionCount: number
  details: Array<{
    qid: string; studentAnswer: string; correctAnswer: string
    score: number; maxScore: number; isCorrect: boolean
    wrongType: string | null; comment: string
  }>
  evaluation: string
  errorAnalysis?: Record<string, unknown>
}

export class BatchGrader extends EventEmitter {
  private abortController: AbortController | null = null

  abort(): void {
    if (this.abortController) { this.abortController.abort(); this.abortController = null }
  }

  async gradeAll(
    assignmentId: number, template: AnswerTemplate, students: ScannedStudent[],
    subject: string, grade: string = '',
  ): Promise<StudentGradeResult[]> {
    const config = await getGradingConfig()
    const results: StudentGradeResult[] = []
    const templateDesc = template.questions.map(q => `第${q.qid}题(${q.type},${q.score}分): ${q.answer}`).join('\n')
    this.abortController = new AbortController()

    for (let i = 0; i < students.length; i++) {
      if (this.abortController.signal.aborted) break
      const student = students[i]
      this.emit('progress', { assignmentId, current: i + 1, total: students.length, studentName: student.name, status: 'grading' })

      try {
        const prompt = resolvePrompt(config.prompts.grade_student, { subject, grade })
        const fullPrompt = `${prompt}\n\n答案模板：\n${templateDesc}\n\n请批改学生 "${student.name}" 的作业。`
        const rawResult = await callQwenVLWithRetry(student.imagePaths, fullPrompt, { model: config.models.grade, provider: config.provider, maxRetries: 2 })
        const gradeResult = this.normalizeResult(student.name, student.imagePaths, template, rawResult)
        results.push(gradeResult)

        try {
          createResult({
            assignment_id: assignmentId, student_name: gradeResult.studentName,
            image_paths: gradeResult.imagePaths, score: gradeResult.score, total: gradeResult.total,
            correct_count: gradeResult.correctCount, question_count: gradeResult.questionCount,
            details: gradeResult.details, evaluation: gradeResult.evaluation, error_analysis: gradeResult.errorAnalysis,
          })
        } catch (dbErr) {
          this.emit('progress', { assignmentId, current: i + 1, total: students.length, studentName: student.name, status: 'error', error: `DB: ${String(dbErr)}` })
        }
        this.emit('progress', { assignmentId, current: i + 1, total: students.length, studentName: student.name, status: 'done' })
      } catch (err) {
        results.push({ studentName: student.name, imagePaths: student.imagePaths, score: 0, total: template.totalScore, correctCount: 0, questionCount: template.questions.length, details: [], evaluation: `Error: ${String(err)}` })
        this.emit('progress', { assignmentId, current: i + 1, total: students.length, studentName: student.name, status: 'error', error: String(err) })
      }
    }

    if (!this.abortController?.signal.aborted) updateAssignmentStatus(assignmentId, 'done')
    this.abortController = null
    return results
  }

  private normalizeResult(studentName: string, imagePaths: string[], template: AnswerTemplate, raw: Record<string, unknown>): StudentGradeResult {
    const rawQuestions = (raw.questions || raw.items || []) as Array<Record<string, unknown>>
    const templateMap = new Map<string, AnswerQuestion>()
    for (const q of template.questions) templateMap.set(q.qid, q)

    const details: StudentGradeResult['details'] = []
    let totalScore = 0; let correctCount = 0

    if (Array.isArray(rawQuestions)) {
      for (const rq of rawQuestions) {
        const qid = String(rq.qid || rq.id || rq['题号'] || '')
        const tq = templateMap.get(qid)
        const maxScore = tq?.score ?? Number(rq.max_score || rq.maxScore || rq['分值'] || 0)
        const score = Number(rq.student_score || rq.score || rq.studentScore || rq['得分'] || 0)
        const isCorrect = rq.is_correct === true || rq.is_correct === 'true' || rq.isCorrect === true || rq['是否正确'] === true || rq['是否正确'] === 'true'
        if (isCorrect) correctCount++
        totalScore += score
        details.push({
          qid,
          studentAnswer: String(rq.student_answer || rq.studentAnswer || rq['学生答案'] || ''),
          correctAnswer: tq?.answer ?? String(rq.correct_answer || rq['正确答案'] || ''),
          score, maxScore, isCorrect,
          wrongType: rq.wrong_type ? String(rq.wrong_type).replace(/^"|"$/g, '') : (rq['错误类型'] ? String(rq['错误类型']) : null),
          comment: String(rq.comment || rq['评语'] || '').slice(0, 100),
        })
      }
    }

    return { studentName, imagePaths, score: totalScore || Number(raw.student_total || raw.totalScore || 0), total: template.totalScore, correctCount, questionCount: template.questions.length, details, evaluation: String(raw.overall_comment || raw.evaluation || '').slice(0, 200), errorAnalysis: raw.error_analysis as Record<string, unknown> | undefined }
  }
}
