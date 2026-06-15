/**
 * Template Extractor — extract answer templates from teacher answer images
 * using Qwen-VL, then allow teacher to review and correct.
 */

import { callQwenVLWithRetry } from './grader'
import { getGradingConfig, resolvePrompt } from './config'

export interface AnswerQuestion {
  qid: string
  type: string
  answer: string
  score: number
}

export interface AnswerTemplate {
  subject: string
  grade: string
  totalScore: number
  questions: AnswerQuestion[]
  rawResponse: Record<string, unknown>
}

export async function extractTemplate(
  answerImagePaths: string[],
  subject: string,
  grade: string = '',
): Promise<AnswerTemplate> {
  const config = await getGradingConfig()
  const prompt = resolvePrompt(config.prompts.extract_template, { subject, grade })

  const rawResponse = await callQwenVLWithRetry(
    answerImagePaths, prompt,
    { model: config.models.extract, provider: config.provider, maxRetries: 2 },
  )

  const questions: AnswerQuestion[] = []
  const rawQuestions = (rawResponse.questions || rawResponse.items) as Array<Record<string, unknown>> | undefined

  if (Array.isArray(rawQuestions)) {
    for (const q of rawQuestions) {
      questions.push({
        qid: String(q.qid || q.id || q.question_number || q['题号'] || q['题目编号'] || questions.length + 1),
        type: String(q.type || q.question_type || q['题型'] || q['题目类型'] || '简答题'),
        answer: String(q.answer || q.correct_answer || q['正确答案'] || q['答案'] || ''),
        score: Number(q.score || q.points || q.value || q['分值'] || q['分数'] || 0),
      })
    }
  }

  return {
    subject, grade,
    totalScore: questions.reduce((sum, q) => sum + q.score, 0),
    questions, rawResponse,
  }
}

export function mergeCorrections(
  template: AnswerTemplate,
  corrections: Array<{ qid: string; answer?: string; score?: number; type?: string }>,
): AnswerTemplate {
  const updatedQuestions = template.questions.map(q => {
    const c = corrections.find(c => c.qid === q.qid)
    if (!c) return q
    return { ...q, answer: c.answer ?? q.answer, score: c.score ?? q.score, type: c.type ?? q.type }
  })
  return { ...template, questions: updatedQuestions, totalScore: updatedQuestions.reduce((sum, q) => sum + q.score, 0) }
}
