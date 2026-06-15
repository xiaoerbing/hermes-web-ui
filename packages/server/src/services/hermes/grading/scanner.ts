/**
 * Scanner — recursively scan the homework root directory to discover
 * classes, assignments, answer images, and student homework files.
 */

import { readdir, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import { getGradingConfig } from './config'

// ============================================================================
// Types
// ============================================================================

export interface ScannedStudent {
  name: string
  imagePaths: string[]
  isMultiPage: boolean
}

export interface ScannedAssignment {
  dirName: string
  dirPath: string
  subject: string
  answerImages: string[]
  students: ScannedStudent[]
  warnings: string[]
}

export interface ScannedClass {
  name: string
  path: string
  assignments: ScannedAssignment[]
}

export interface ScanResult {
  rootPath: string
  classes: ScannedClass[]
  warnings: string[]
}

// ============================================================================
// Helpers
// ============================================================================

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

function isImage(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filename).toLowerCase())
}

const SUBJECT_KEYWORDS: Array<[string, string]> = [
  ['语文', '语文'], ['数学', '数学'], ['英语', '英语'],
  ['物理', '物理'], ['化学', '化学'], ['生物', '生物'],
  ['历史', '历史'], ['地理', '地理'], ['政治', '政治'],
  ['科学', '科学'], ['道德', '道德与法治'], ['法治', '道德与法治'],
]

function inferSubject(dirName: string): string {
  for (const [keyword, subject] of SUBJECT_KEYWORDS) {
    if (dirName.includes(keyword)) return subject
  }
  return ''
}

const STUDENT_GROWTH_SUFFIX = '_成长记录.md'
const REPORT_PREFIX = '批改报告'

function isReportOrGrowthFile(filename: string): boolean {
  return filename.startsWith(REPORT_PREFIX) || filename.endsWith(STUDENT_GROWTH_SUFFIX)
}

function studentNameFromFile(filename: string): string {
  return basename(filename, extname(filename))
}

// ============================================================================
// Scanner
// ============================================================================

async function scanAssignmentDir(
  dirPath: string,
  answerKeyword: string,
): Promise<ScannedAssignment> {
  const dirName = basename(dirPath)
  const answerImages: string[] = []
  const students: ScannedStudent[] = []
  const warnings: string[] = []

  let entries: string[] = []
  try {
    entries = await readdir(dirPath)
  } catch {
    warnings.push(`Cannot read assignment directory: ${dirPath}`)
    return { dirName, dirPath, subject: '', answerImages, students, warnings }
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    if (isReportOrGrowthFile(entry) || entry.startsWith('.')) continue

    let entryStat
    try { entryStat = await stat(fullPath) } catch { continue }

    if (entryStat.isDirectory()) {
      if (entry.includes(answerKeyword)) {
        try {
          const answerFiles = await readdir(fullPath)
          for (const af of answerFiles) {
            if (isImage(af) && !af.startsWith('.')) answerImages.push(join(fullPath, af))
          }
          answerImages.sort()
        } catch { warnings.push(`Cannot read answer directory: ${fullPath}`) }
      } else {
        try {
          const pageFiles = await readdir(fullPath)
          const pageImages = pageFiles
            .filter(f => isImage(f) && !f.startsWith('.'))
            .sort()
            .map(f => join(fullPath, f))
          if (pageImages.length > 0) {
            students.push({ name: entry, imagePaths: pageImages, isMultiPage: true })
          }
        } catch { warnings.push(`Cannot read student directory: ${fullPath}`) }
      }
    } else if (entryStat.isFile() && isImage(entry)) {
      if (entry.includes(answerKeyword)) {
        answerImages.push(fullPath)
      } else {
        students.push({ name: studentNameFromFile(entry), imagePaths: [fullPath], isMultiPage: false })
      }
    }
  }

  answerImages.sort()
  students.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  return { dirName, dirPath, subject: inferSubject(dirName), answerImages, students, warnings }
}

async function scanClassDir(dirPath: string, answerKeyword: string): Promise<ScannedClass> {
  const name = basename(dirPath)
  const assignments: ScannedAssignment[] = []

  let entries: string[] = []
  try { entries = await readdir(dirPath) } catch { return { name, path: dirPath, assignments } }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    if (entry.startsWith('.') || entry.endsWith(STUDENT_GROWTH_SUFFIX)) continue

    let entryStat
    try { entryStat = await stat(fullPath) } catch { continue }

    if (entryStat.isDirectory()) {
      const assignment = await scanAssignmentDir(fullPath, answerKeyword)
      if (assignment.answerImages.length > 0 || assignment.students.length > 0) {
        assignments.push(assignment)
      }
    }
  }

  assignments.sort((a, b) => a.dirName.localeCompare(b.dirName, 'zh-CN'))
  return { name, path: dirPath, assignments }
}

/**
 * Scan the entire homework root directory.
 */
export async function scanRoot(rootPath: string, answerKeyword?: string): Promise<ScanResult> {
  const warnings: string[] = []
  const classes: ScannedClass[] = []

  let keyword = answerKeyword
  if (!keyword) {
    try { const config = await getGradingConfig(); keyword = config.answerKeyword }
    catch { keyword = '答案' }
  }

  let entries: string[] = []
  try { entries = await readdir(rootPath) } catch {
    warnings.push(`Cannot read root directory: ${rootPath}`)
    return { rootPath, classes, warnings }
  }

  for (const entry of entries) {
    const fullPath = join(rootPath, entry)
    if (entry.startsWith('.')) continue

    let entryStat
    try { entryStat = await stat(fullPath) } catch { continue }

    if (entryStat.isDirectory()) {
      const scanned = await scanClassDir(fullPath, keyword)
      if (scanned.assignments.length > 0) classes.push(scanned)
    }
  }

  classes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  for (const cls of classes) {
    for (const asgn of cls.assignments) warnings.push(...asgn.warnings)
  }

  return { rootPath, classes, warnings }
}

/**
 * Scan a single assignment directory directly.
 */
export async function scanAssignment(
  dirPath: string,
  answerKeyword?: string,
): Promise<ScannedAssignment> {
  let keyword = answerKeyword
  if (!keyword) {
    try { const config = await getGradingConfig(); keyword = config.answerKeyword }
    catch { keyword = '答案' }
  }
  return scanAssignmentDir(dirPath, keyword)
}
