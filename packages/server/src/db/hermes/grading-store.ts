/**
 * Homework Grading Store — CRUD operations for grading_assignments,
 * grading_templates, and grading_results tables.
 *
 * Mirrors the pattern from usage-store.ts and sessions-db.ts:
 * prepared statements + isSqliteAvailable() guard.
 */

import { isSqliteAvailable, getDb } from '../index'
import {
  GRADING_ASSIGNMENTS_TABLE,
  GRADING_TEMPLATES_TABLE,
  GRADING_RESULTS_TABLE,
} from './schemas'

// ============================================================================
// Types
// ============================================================================

export type AssignmentStatus =
  | 'discovered'
  | 'template_extracting'
  | 'template_ready'
  | 'grading'
  | 'done'
  | 'error'

export interface GradingAssignment {
  id: number
  class_name: string
  dir_name: string
  dir_path: string
  subject: string
  answer_images: string  // JSON array
  student_count: number
  status: AssignmentStatus
  created_at: number
}

export interface GradingTemplate {
  id: number
  assignment_id: number
  raw_extraction: string   // JSON
  corrected_data: string   // JSON
  is_confirmed: number     // 0 or 1
  confirmed_at: number | null
  created_at: number
}

export interface GradingResult {
  id: number
  assignment_id: number
  student_name: string
  image_paths: string      // JSON array
  score: number
  total: number
  correct_count: number
  question_count: number
  details: string          // JSON array
  evaluation: string
  error_analysis: string | null  // JSON
  created_at: number
}

export interface CreateAssignmentInput {
  class_name: string
  dir_name: string
  dir_path: string
  subject?: string
  answer_images?: string[]
  student_count?: number
}

export interface CreateResultInput {
  assignment_id: number
  student_name: string
  image_paths: string[]
  score: number
  total: number
  correct_count: number
  question_count: number
  details: Record<string, unknown>[]
  evaluation: string
  error_analysis?: Record<string, unknown>
}

// ============================================================================
// Assignments
// ============================================================================

export function createAssignment(input: CreateAssignmentInput): GradingAssignment {
  const db = getDb()
  if (!db) throw new Error('Database not available')

  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO ${GRADING_ASSIGNMENTS_TABLE}
      (class_name, dir_name, dir_path, subject, answer_images, student_count, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'discovered', ?)
  `)
  const result = stmt.run(
    input.class_name,
    input.dir_name,
    input.dir_path,
    input.subject || '',
    JSON.stringify(input.answer_images || []),
    input.student_count || 0,
    now,
  )
  return {
    id: Number(result.lastInsertRowid),
    class_name: input.class_name,
    dir_name: input.dir_name,
    dir_path: input.dir_path,
    subject: input.subject || '',
    answer_images: JSON.stringify(input.answer_images || []),
    student_count: input.student_count || 0,
    status: 'discovered',
    created_at: now,
  }
}

export function getAssignment(id: number): GradingAssignment | undefined {
  const db = getDb()
  if (!db) return undefined
  return db.prepare(
    `SELECT * FROM ${GRADING_ASSIGNMENTS_TABLE} WHERE id = ?`
  ).get(id) as GradingAssignment | undefined
}

export function getAssignmentByPath(dirPath: string): GradingAssignment | undefined {
  const db = getDb()
  if (!db) return undefined
  return db.prepare(
    `SELECT * FROM ${GRADING_ASSIGNMENTS_TABLE} WHERE dir_path = ?`
  ).get(dirPath) as GradingAssignment | undefined
}

export function listAssignmentsByClass(className: string): GradingAssignment[] {
  const db = getDb()
  if (!db) return []
  return db.prepare(
    `SELECT * FROM ${GRADING_ASSIGNMENTS_TABLE} WHERE class_name = ? ORDER BY created_at DESC`
  ).all(className) as unknown as GradingAssignment[]
}

export function listAllAssignments(): GradingAssignment[] {
  const db = getDb()
  if (!db) return []
  return db.prepare(
    `SELECT * FROM ${GRADING_ASSIGNMENTS_TABLE} ORDER BY created_at DESC`
  ).all() as unknown as GradingAssignment[]
}

export function listDistinctClasses(): string[] {
  const db = getDb()
  if (!db) return []
  const rows = db.prepare(
    `SELECT DISTINCT class_name FROM ${GRADING_ASSIGNMENTS_TABLE} ORDER BY class_name`
  ).all() as Array<{ class_name: string }>
  return rows.map(r => r.class_name)
}

export function updateAssignmentStatus(id: number, status: AssignmentStatus): void {
  const db = getDb()
  if (!db) return
  db.prepare(
    `UPDATE ${GRADING_ASSIGNMENTS_TABLE} SET status = ? WHERE id = ?`
  ).run(status, id)
}

export function updateAssignmentStudentCount(id: number, studentCount: number): void {
  const db = getDb()
  if (!db) return
  db.prepare(
    `UPDATE ${GRADING_ASSIGNMENTS_TABLE} SET student_count = ? WHERE id = ?`
  ).run(studentCount, id)
}

export function deleteAssignment(id: number): void {
  const db = getDb()
  if (!db) return
  db.prepare(`DELETE FROM ${GRADING_TEMPLATES_TABLE} WHERE assignment_id = ?`).run(id)
  db.prepare(`DELETE FROM ${GRADING_RESULTS_TABLE} WHERE assignment_id = ?`).run(id)
  db.prepare(`DELETE FROM ${GRADING_ASSIGNMENTS_TABLE} WHERE id = ?`).run(id)
}

// ============================================================================
// Templates
// ============================================================================

export function upsertTemplate(
  assignmentId: number,
  rawExtraction: Record<string, unknown>,
  correctedData?: Record<string, unknown>,
): GradingTemplate {
  const db = getDb()
  if (!db) throw new Error('Database not available')

  const now = Date.now()
  const raw = JSON.stringify(rawExtraction)
  const corrected = correctedData ? JSON.stringify(correctedData) : raw

  const existing = db.prepare(
    `SELECT id FROM ${GRADING_TEMPLATES_TABLE} WHERE assignment_id = ?`
  ).get(assignmentId) as { id: number } | undefined

  if (existing) {
    db.prepare(`
      UPDATE ${GRADING_TEMPLATES_TABLE}
      SET raw_extraction = ?, corrected_data = ?, is_confirmed = 0, confirmed_at = NULL
      WHERE assignment_id = ?
    `).run(raw, corrected, assignmentId)
    return {
      id: existing.id,
      assignment_id: assignmentId,
      raw_extraction: raw,
      corrected_data: corrected,
      is_confirmed: 0,
      confirmed_at: null,
      created_at: now,
    }
  }

  const result = db.prepare(`
    INSERT INTO ${GRADING_TEMPLATES_TABLE}
      (assignment_id, raw_extraction, corrected_data, is_confirmed, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(assignmentId, raw, corrected, now)

  return {
    id: Number(result.lastInsertRowid),
    assignment_id: assignmentId,
    raw_extraction: raw,
    corrected_data: corrected,
    is_confirmed: 0,
    confirmed_at: null,
    created_at: now,
  }
}

export function getTemplate(assignmentId: number): GradingTemplate | undefined {
  const db = getDb()
  if (!db) return undefined
  return db.prepare(
    `SELECT * FROM ${GRADING_TEMPLATES_TABLE} WHERE assignment_id = ?`
  ).get(assignmentId) as GradingTemplate | undefined
}

export function confirmTemplate(assignmentId: number, correctedData: Record<string, unknown>): void {
  const db = getDb()
  if (!db) return
  const now = Date.now()
  db.prepare(`
    UPDATE ${GRADING_TEMPLATES_TABLE}
    SET corrected_data = ?, is_confirmed = 1, confirmed_at = ?
    WHERE assignment_id = ?
  `).run(JSON.stringify(correctedData), now, assignmentId)
}

// ============================================================================
// Results
// ============================================================================

export function createResult(input: CreateResultInput): GradingResult {
  const db = getDb()
  if (!db) throw new Error('Database not available')

  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO ${GRADING_RESULTS_TABLE}
      (assignment_id, student_name, image_paths, score, total, correct_count, question_count, details, evaluation, error_analysis, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    input.assignment_id,
    input.student_name,
    JSON.stringify(input.image_paths),
    input.score,
    input.total,
    input.correct_count,
    input.question_count,
    JSON.stringify(input.details),
    input.evaluation,
    input.error_analysis ? JSON.stringify(input.error_analysis) : null,
    now,
  )
  return {
    id: Number(result.lastInsertRowid),
    assignment_id: input.assignment_id,
    student_name: input.student_name,
    image_paths: JSON.stringify(input.image_paths),
    score: input.score,
    total: input.total,
    correct_count: input.correct_count,
    question_count: input.question_count,
    details: JSON.stringify(input.details),
    evaluation: input.evaluation,
    error_analysis: input.error_analysis ? JSON.stringify(input.error_analysis) : null,
    created_at: now,
  }
}

export function getResult(id: number): GradingResult | undefined {
  const db = getDb()
  if (!db) return undefined
  return db.prepare(
    `SELECT * FROM ${GRADING_RESULTS_TABLE} WHERE id = ?`
  ).get(id) as GradingResult | undefined
}

export function listResultsByAssignment(assignmentId: number): GradingResult[] {
  const db = getDb()
  if (!db) return []
  return db.prepare(
    `SELECT * FROM ${GRADING_RESULTS_TABLE} WHERE assignment_id = ? ORDER BY student_name`
  ).all(assignmentId) as unknown as GradingResult[]
}

export function getResultByStudent(assignmentId: number, studentName: string): GradingResult | undefined {
  const db = getDb()
  if (!db) return undefined
  return db.prepare(
    `SELECT * FROM ${GRADING_RESULTS_TABLE} WHERE assignment_id = ? AND student_name = ?`
  ).get(assignmentId, studentName) as GradingResult | undefined
}

export function listResultsByStudent(classNames: string[], studentName: string): GradingResult[] {
  const db = getDb()
  if (!db || classNames.length === 0) return []

  const placeholders = classNames.map(() => '?').join(',')
  return db.prepare(`
    SELECT r.* FROM ${GRADING_RESULTS_TABLE} r
    JOIN ${GRADING_ASSIGNMENTS_TABLE} a ON r.assignment_id = a.id
    WHERE a.class_name IN (${placeholders}) AND r.student_name = ?
    ORDER BY r.created_at ASC
  `).all(...classNames, studentName) as unknown as GradingResult[]
}

export function deleteResultsByAssignment(assignmentId: number): void {
  const db = getDb()
  if (!db) return
  db.prepare(
    `DELETE FROM ${GRADING_RESULTS_TABLE} WHERE assignment_id = ?`
  ).run(assignmentId)
}

// ============================================================================
// Aggregation
// ============================================================================

export function getAssignmentStats(assignmentId: number): {
  student_count: number
  avg_score: number
  max_score: number
  min_score: number
  pass_count: number
  pass_rate: number
} {
  const db = getDb()
  const empty = { student_count: 0, avg_score: 0, max_score: 0, min_score: 0, pass_count: 0, pass_rate: 0 }
  if (!db) return empty

  const row = db.prepare(`
    SELECT
      COUNT(*) as student_count,
      COALESCE(AVG(score), 0) as avg_score,
      COALESCE(MAX(score), 0) as max_score,
      COALESCE(MIN(score), 0) as min_score,
      COALESCE(SUM(CASE WHEN total > 0 AND (score * 1.0 / total) >= 0.6 THEN 1 ELSE 0 END), 0) as pass_count
    FROM ${GRADING_RESULTS_TABLE}
    WHERE assignment_id = ?
  `).get(assignmentId) as {
    student_count: number
    avg_score: number
    max_score: number
    min_score: number
    pass_count: number
  }

  if (!row || row.student_count === 0) return empty
  return {
    student_count: row.student_count,
    avg_score: Math.round(row.avg_score * 100) / 100,
    max_score: row.max_score,
    min_score: row.min_score,
    pass_count: row.pass_count,
    pass_rate: Math.round((row.pass_count / row.student_count) * 10000) / 100,
  }
}
