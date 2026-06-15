import type { Context } from 'koa'
import { join, resolve } from 'path'
import { readFile } from 'fs/promises'
import { getActiveProfileName } from '../../services/hermes/hermes-profile'
import { getGradingConfig, updateGradingConfig } from '../../services/hermes/grading/config'
import { scanRoot, scanAssignment as scanAssignmentDir } from '../../services/hermes/grading/scanner'
import { extractTemplate } from '../../services/hermes/grading/template-extractor'
import { BatchGrader } from '../../services/hermes/grading/batch-grader'
import { writeAssignmentReport, updateGrowthRecord } from '../../services/hermes/grading/report-writer'
import { analyzeStudentGrowth } from '../../services/hermes/grading/growth-analyzer'
import {
  createAssignment, getAssignment, getAssignmentByPath,
  listAssignmentsByClass, listDistinctClasses,
  updateAssignmentStatus, updateAssignmentStudentCount,
  upsertTemplate, getTemplate, confirmTemplate,
  getResult, listResultsByAssignment, getAssignmentStats,
  deleteResultsByAssignment,
} from '../../db/hermes/grading-store'
import type { GradingConfig } from '../../services/hermes/grading/config'

function requestedProfile(ctx: Context): string {
  return ctx.state?.profile?.name || getActiveProfileName() || 'default'
}
function errorResponse(ctx: Context, status: number, message: string): void {
  ctx.status = status; ctx.body = { error: message }
}

const activeGraders = new Map<number, BatchGrader>()
const gradingProgressMap = new Map<number, {
  current: number; total: number; studentName: string; status: string; error?: string
}>()

export async function getConfig(ctx: Context): Promise<void> {
  try { ctx.body = { grading: await getGradingConfig(requestedProfile(ctx)) } }
  catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function updateConfig(ctx: Context): Promise<void> {
  try {
    const v = ctx.request.body as Partial<GradingConfig>
    if (!v || typeof v !== 'object') { errorResponse(ctx, 400, 'Missing config'); return }
    await updateGradingConfig(v, requestedProfile(ctx))
    ctx.body = { success: true }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function listClasses(ctx: Context): Promise<void> {
  try { ctx.body = { classes: listDistinctClasses() } }
  catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function listClassAssignments(ctx: Context): Promise<void> {
  try {
    const cn = ctx.params.name
    ctx.body = { className: cn, assignments: listAssignmentsByClass(cn) }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function scanAssignments(ctx: Context): Promise<void> {
  try {
    const config = await getGradingConfig()
    const rootPath = (ctx.request.body as any)?.rootPath || config.rootPath
    const result = await scanRoot(resolve(rootPath), config.answerKeyword)
    for (const cls of result.classes) {
      for (const asgn of cls.assignments) {
        const existing = getAssignmentByPath(asgn.dirPath)
        if (!existing) {
          createAssignment({
            class_name: cls.name, dir_name: asgn.dirName, dir_path: asgn.dirPath,
            subject: asgn.subject, answer_images: asgn.answerImages,
            student_count: asgn.students.length,
          })
        } else {
          updateAssignmentStudentCount(existing.id, asgn.students.length)
        }
      }
    }
    ctx.body = result
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function getAssignmentDetail(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const a = getAssignment(id)
    if (!a) { errorResponse(ctx, 404, 'Not found'); return }
    const config = await getGradingConfig()
    const scanned = await scanAssignmentDir(a.dir_path, config.answerKeyword)
    ctx.body = {
      ...a, answer_images: JSON.parse(a.answer_images),
      students: scanned.students, warnings: scanned.warnings,
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function extractTemplateHandler(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const a = getAssignment(id)
    if (!a) { errorResponse(ctx, 404, 'Not found'); return }
    const images: string[] = JSON.parse(a.answer_images)
    if (images.length === 0) { errorResponse(ctx, 400, 'No answer images'); return }
    updateAssignmentStatus(id, 'template_extracting')
    const tmpl = await extractTemplate(images, a.subject || '')
    upsertTemplate(id, tmpl.rawResponse, {
      subject: tmpl.subject, totalScore: tmpl.totalScore, questions: tmpl.questions,
    })
    updateAssignmentStatus(id, 'template_ready')
    ctx.body = { assignment_id: id, template: tmpl }
  } catch (err: any) {
    updateAssignmentStatus(parseInt(ctx.params.id, 10), 'error')
    errorResponse(ctx, 500, err.message)
  }
}

export async function getTemplateHandler(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const t = getTemplate(id)
    if (!t) { errorResponse(ctx, 404, 'Template not found'); return }
    ctx.body = {
      assignment_id: id,
      raw_extraction: JSON.parse(t.raw_extraction),
      corrected_data: JSON.parse(t.corrected_data),
      is_confirmed: t.is_confirmed === 1, confirmed_at: t.confirmed_at,
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function updateTemplateHandler(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const body = ctx.request.body as {
      corrections?: Array<{ qid: string; answer?: string; score?: number; type?: string }>
      confirmed?: boolean
    }
    if (!body) { errorResponse(ctx, 400, 'Missing body'); return }
    const t = getTemplate(id)
    if (!t) { errorResponse(ctx, 404, 'Not found'); return }
    if (body.corrections) {
      const c = JSON.parse(t.corrected_data || t.raw_extraction)
      if (c.questions) {
        for (const corr of body.corrections) {
          const q = c.questions.find((q: any) => q.qid === corr.qid)
          if (q) {
            if (corr.answer !== undefined) q.answer = corr.answer
            if (corr.score !== undefined) q.score = corr.score
            if (corr.type !== undefined) q.type = corr.type
          }
        }
      }
      upsertTemplate(id, JSON.parse(t.raw_extraction), c)
    }
    if (body.confirmed) {
      const cur = getTemplate(id)
      if (cur) {
        confirmTemplate(id, JSON.parse(cur.corrected_data || cur.raw_extraction))
        updateAssignmentStatus(id, 'template_ready')
      }
    }
    ctx.body = { success: true }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function startGrading(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const a = getAssignment(id)
    if (!a) { errorResponse(ctx, 404, 'Not found'); return }
    const t = getTemplate(id)
    if (!t || t.is_confirmed !== 1) {
      errorResponse(ctx, 400, 'Template not confirmed'); return
    }
    const cd = JSON.parse(t.corrected_data)
    const template = {
      subject: cd.subject || a.subject, grade: cd.grade || '',
      totalScore: cd.totalScore || 0, questions: cd.questions || [],
      rawResponse: {},
    }
    const config = await getGradingConfig()
    const scanned = await scanAssignmentDir(a.dir_path, config.answerKeyword)
    if (scanned.students.length === 0) {
      errorResponse(ctx, 400, 'No students found'); return
    }
    updateAssignmentStudentCount(id, scanned.students.length)
    updateAssignmentStatus(id, 'grading')
    deleteResultsByAssignment(id)

    const grader = new BatchGrader()
    activeGraders.set(id, grader)
    grader.on('progress', (p: any) => {
      gradingProgressMap.set(id, {
        current: p.current, total: p.total,
        studentName: p.studentName, status: p.status, error: p.error,
      })
    })

    grader.gradeAll(id, template, scanned.students, a.subject).then(async (results) => {
      try {
        const classDir = join(a.dir_path, '..')
        await writeAssignmentReport(a.dir_path, a.dir_name, a.subject, template, results)
        for (const r of results) {
          await updateGrowthRecord(
            classDir, r.studentName, a.class_name,
            a.dir_name, a.subject, r, template,
          )
        }
        updateAssignmentStatus(id, 'done')
      } catch (e) {
        console.error('Report generation failed:', e)
        updateAssignmentStatus(id, 'done')
      } finally {
        activeGraders.delete(id); gradingProgressMap.delete(id)
      }
    }).catch((e) => {
      console.error('Batch grading failed:', e)
      updateAssignmentStatus(id, 'error'); activeGraders.delete(id)
    })

    ctx.body = {
      assignment_id: id, job: 'started',
      total_students: scanned.students.length,
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function gradingProgress(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const a = getAssignment(id)
    if (!a) { errorResponse(ctx, 404, 'Not found'); return }
    ctx.body = {
      assignment_id: id, status: a.status,
      progress: gradingProgressMap.get(id) || null,
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function listResults(ctx: Context): Promise<void> {
  try {
    const aid = ctx.query.assignment_id
      ? parseInt(ctx.query.assignment_id as string, 10) : undefined
    if (aid && !isNaN(aid)) {
      ctx.body = {
        results: listResultsByAssignment(aid),
        stats: getAssignmentStats(aid),
      }
    } else {
      ctx.body = { results: [], message: 'Filter by assignment_id' }
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function getResultDetail(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const r = getResult(id)
    if (!r) { errorResponse(ctx, 404, 'Not found'); return }
    ctx.body = {
      ...r, image_paths: JSON.parse(r.image_paths),
      details: JSON.parse(r.details),
      error_analysis: r.error_analysis ? JSON.parse(r.error_analysis) : null,
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function downloadReport(ctx: Context): Promise<void> {
  try {
    const id = parseInt(ctx.params.id, 10)
    if (isNaN(id)) { errorResponse(ctx, 400, 'Invalid ID'); return }
    const a = getAssignment(id)
    if (!a) { errorResponse(ctx, 404, 'Not found'); return }
    const config = await getGradingConfig()
    const rp = join(a.dir_path, config.reportPrefix + '_' + a.dir_name + '.md')
    try {
      ctx.type = 'text/markdown; charset=utf-8'
      ctx.body = await readFile(rp, 'utf-8')
    } catch {
      errorResponse(ctx, 404, 'Report not found')
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function getStudentGrowth(ctx: Context): Promise<void> {
  try {
    const cn = ctx.query.class as string
    if (!cn) { errorResponse(ctx, 400, 'Query param class required'); return }
    ctx.body = await analyzeStudentGrowth(ctx.params.name, [cn])
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function getStudentGrowthRaw(ctx: Context): Promise<void> {
  try {
    const cd = ctx.query.dir as string
    if (!cd) { errorResponse(ctx, 400, 'Query param dir required'); return }
    const config = await getGradingConfig()
    const rp = join(cd, ctx.params.name + config.growthSuffix + '.md')
    try {
      ctx.type = 'text/markdown; charset=utf-8'
      ctx.body = await readFile(rp, 'utf-8')
    } catch {
      errorResponse(ctx, 404, 'Growth record not found')
    }
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}

export async function analyzeStudentGrowthHandler(ctx: Context): Promise<void> {
  try {
    const cn = ctx.query.class as string
    if (!cn) { errorResponse(ctx, 400, 'Query param class required'); return }
    ctx.body = await analyzeStudentGrowth(ctx.params.name, [cn])
  } catch (err: any) { errorResponse(ctx, 500, err.message) }
}
