/**
 * Grader — Qwen-VL API client with 3-layer JSON parsing tolerance.
 * Uses Hermes provider system for API key resolution (from profile .env).
 */

import { readFileSync } from 'fs'
import { extname } from 'path'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getActiveProfileName, getProfileDir } from '../hermes-profile'

// ============================================================================
// Provider config
// ============================================================================

const PROVIDER_ENDPOINTS: Record<string, string> = {
  dashscope: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
}

const PROVIDER_KEY_ENV: Record<string, string> = {
  dashscope: 'DASHSCOPE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

async function resolveApiKey(provider: string): Promise<string> {
  // 1. Check environment variable
  const envVar = PROVIDER_KEY_ENV[provider] || (provider.toUpperCase() + '_API_KEY')
  if (process.env[envVar]) return process.env[envVar]!

  // 2. Check profile .env file
  try {
    const profile = getActiveProfileName() || 'default'
    const envPath = join(getProfileDir(profile), '.env')
    const raw = await readFile(envPath, 'utf-8')
    const rawLines = raw.replace(/\r\n/g, '\n').split('\n')
    for (const line of rawLines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (key === envVar && val) return val
    }
  } catch {}

  throw new Error(
    'API key not found for provider ' + provider + '. Set ' + envVar + ' in environment or ~/.hermes/.env'
  )
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
}

function imageMimeType(filePath: string): string {
  return IMAGE_MIME[extname(filePath).toLowerCase()] || 'image/jpeg'
}

// ============================================================================
// API Call
// ============================================================================

export interface QwenVLOptions {
  model?: string
  temperature?: number
  timeout?: number
  provider?: string
}

export async function callQwenVL(
  imagePaths: string[],
  prompt: string,
  options: QwenVLOptions = {},
): Promise<Record<string, unknown>> {
  const { model = 'qwen3-vl-plus', temperature = 0.1, timeout = 120, provider = 'dashscope' } = options
  const apiKey = await resolveApiKey(provider)
  const endpoint = PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.dashscope

  const content: Array<Record<string, unknown>> = []
  for (const imagePath of imagePaths) {
    const imgBuffer = readFileSync(imagePath)
    const imgB64 = imgBuffer.toString('base64')
    const mime = imageMimeType(imagePath)
    content.push({ image: 'data:' + mime + ';base64,' + imgB64 })
  }
  content.push({ text: prompt })

  const payload = {
    model,
    input: { messages: [{ role: 'user', content }] },
    parameters: { temperature },
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout * 1000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error('API error ' + response.status + ': ' + errorText.slice(0, 500))
    }

    const body = (await response.json()) as Record<string, unknown>
    const output = body.output as Record<string, unknown> | undefined
    const choices = output?.choices as Array<Record<string, unknown>> | undefined
    const message = choices?.[0]?.message as Record<string, unknown> | undefined
    let text = message?.content as string | Array<{ text?: string }> | undefined

    if (Array.isArray(text)) {
      text = text.map(item => item.text || '').join(' ')
    }
    if (!text || typeof text !== 'string') {
      throw new Error('Unexpected API response: ' + JSON.stringify(body).slice(0, 300))
    }

    return parseJson(text)
  } finally {
    clearTimeout(timer)
  }
}

// 3-Layer JSON Parsing
// ============================================================================

/**
 * Parse JSON from LLM output with multi-layer fallback.
 * Layer 1: Extract ```json block, parse directly
 * Layer 2: Find outermost { } via stack counting (handles nested braces in strings)
 * Layer 3: Regex field extraction (ultimate fallback for partial corruption)
 */
export function parseJson(text: string): Record<string, unknown> {
  const raw = String(text)
  let lastError = ''

  // Extract ```json ... ``` block
  let extracted = raw
  const marker = '```json'
  const markerIdx = raw.indexOf(marker)
  if (markerIdx >= 0) {
    const start = markerIdx + marker.length
    const end = raw.indexOf('```', start)
    if (end > start) extracted = raw.slice(start, end).trim()
  }

  // Layer 1: Direct parse
  try {
    const parsed = JSON.parse(extracted)
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { __meta: { parse_method: 'marker_direct' }, ...parsed }
    }
    return { __meta: { parse_method: 'marker_direct' }, items: parsed }
  } catch (e) { lastError = e instanceof Error ? e.message : String(e) }

  // Layer 2: Stack-counting brace matching
  const leftBrace = extracted.indexOf('{')
  if (leftBrace >= 0) {
    let depth = 0, inString = false, escape = false
    for (let i = leftBrace; i < extracted.length; i++) {
      const ch = extracted[i]
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"' && !escape) { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            const parsed = JSON.parse(extracted.slice(leftBrace, i + 1))
            return { __meta: { parse_method: 'stack' }, ...parsed }
          } catch (e) { lastError = e instanceof Error ? e.message : String(e) }
          break
        }
      }
    }
  }

  // Layer 3: Regex reconstruction
  try {
    const reconstructed = reconstructJson(extracted)
    if (reconstructed && hasMeaningfulData(reconstructed)) {
      return { __meta: { parse_method: 'reconstruct' }, ...reconstructed }
    }
  } catch { /* exhausted */ }

  throw new Error(
    `JSON parse failed. Last error: ${lastError}. Raw (first 500): ${raw.slice(0, 500)}`,
  )
}

function reconstructJson(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const extract = (pattern: RegExp, source: string, def: string | null = null): string | null => {
    const m = source.match(pattern)
    return m ? (m[1] || '').trim() : def
  }

  result.student_name = extract(/"student_name"\s*:\s*"([^"]*)"/, text) || 'Unknown'
  result.class_name = extract(/"class_name"\s*:\s*"([^"]*)"/, text) || 'Unknown'

  const totalStr = extract(/"student_total"\s*:\s*([0-9]+(?:\.[0-9]+)?)/, text)
  if (totalStr) result.student_total = totalStr.includes('.') ? parseFloat(totalStr) : parseInt(totalStr, 10)

  result.overall_comment = extract(/"overall_comment"\s*:\s*"([^"]{1,50})"/, text) || ''

  const questions: Array<Record<string, unknown>> = []
  const qPattern = /"qid"\s*:\s*"([^"]+)"[\s\S]*?"student_answer"\s*:\s*"([^"]*)"[\s\S]*?"student_score"\s*:\s*([0-9]+(?:\.[0-9]+)?)[\s\S]*?"is_correct"\s*:\s*(true|false)[\s\S]*?"wrong_type"\s*:\s*(null|"[^"]*")[\s\S]*?"comment"\s*:\s*"([^"]{1,30})"/g

  let match: RegExpExecArray | null
  while ((match = qPattern.exec(text)) !== null) {
    const wt = match[5].replace(/"/g, '')
    questions.push({
      qid: match[1],
      student_answer: match[2],
      student_score: match[3].includes('.') ? parseFloat(match[3]) : parseInt(match[3], 10),
      is_correct: match[4] === 'true',
      wrong_type: wt === 'null' ? null : wt,
      comment: match[6],
    })
  }

  if (questions.length > 0) {
    result.questions = questions
    if (result.student_total === 0) {
      result.student_total = questions.reduce((s, q) => s + (typeof q.student_score === 'number' ? q.student_score : 0), 0)
    }
  }

  return result
}


function hasMeaningfulData(data: Record<string, unknown>): boolean {
  if (Object.keys(data).length === 0) return false
  if (typeof data.student_name === "string" && data.student_name && data.student_name !== "Unknown" && data.student_name !== "未知") return true
  if (Array.isArray(data.questions) && data.questions.length > 0) return true
  if (typeof data.student_total === "number" && data.student_total > 0) return true
  if (Array.isArray(data.items) && data.items.length > 0) return true
  if (typeof data.totalScore === "number" && data.totalScore > 0) return true
  if (data.subject) return true
  return false
}
// ============================================================================
// Retry helper
// ============================================================================

export async function callQwenVLWithRetry(
  imagePaths: string[],
  prompt: string,
  options: QwenVLOptions & { maxRetries?: number } = {},
): Promise<Record<string, unknown>> {
  const { maxRetries = 2, ...apiOptions } = options
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callQwenVL(imagePaths, prompt, apiOptions)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000 * (attempt + 1)))
      }
    }
  }
  throw lastError || new Error('Max retries exceeded')
}
