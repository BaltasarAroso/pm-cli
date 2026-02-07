import Anthropic from '@anthropic-ai/sdk'
import type { ReviewFinding } from './types.js'
import { CODE_REVIEW_SYSTEM_PROMPT, buildUserPrompt } from '../prompts/code-review.js'
import {
  getTicketSystemPrompt,
  buildTicketCreatePrompt,
  buildTicketEditPrompt,
  type TicketStyle,
} from '../prompts/ticket.js'

/**
 * Call the Anthropic API to review a diff against coding guidelines.
 * Returns structured findings as an array.
 */
export async function reviewWithAI(
  apiKey: string,
  diff: string,
  guidelines: string,
  changedFiles: string
): Promise<ReviewFinding[]> {
  const client = new Anthropic({ apiKey })

  const userPrompt = buildUserPrompt(guidelines, diff, changedFiles)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: CODE_REVIEW_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Extract text from response
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic API')
  }

  const rawText = textBlock.text.trim()

  // Parse JSON -- handle potential markdown wrapping
  let jsonStr = rawText
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  let findings: ReviewFinding[]
  try {
    findings = JSON.parse(jsonStr)
  } catch {
    throw new Error(`Failed to parse AI response as JSON:\n${rawText.substring(0, 500)}`)
  }

  if (!Array.isArray(findings)) {
    throw new Error('AI response is not an array of findings')
  }

  // Ensure all findings have approved: null
  return findings.map((f) => ({ ...f, approved: null }))
}

export interface TicketContent {
  title: string
  description: string
}

/**
 * Call the Anthropic API to generate a Linear ticket from user input.
 * Returns structured ticket content with title and description.
 */
export async function generateTicketWithAI(
  apiKey: string,
  userInput: string,
  style: TicketStyle = 'descriptive',
  context?: string
): Promise<TicketContent> {
  const client = new Anthropic({ apiKey })

  const userPrompt = buildTicketCreatePrompt(userInput, style, context)
  const systemPrompt = getTicketSystemPrompt(style)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Extract text from response
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic API')
  }

  const rawText = textBlock.text.trim()

  // Parse JSON -- handle potential markdown wrapping
  let jsonStr = rawText
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  let ticket: TicketContent
  try {
    ticket = JSON.parse(jsonStr)
  } catch {
    throw new Error(`Failed to parse AI response as JSON:\n${rawText.substring(0, 500)}`)
  }

  if (!ticket.title || !ticket.description) {
    throw new Error('AI response missing required fields (title, description)')
  }

  return ticket
}

/**
 * Call the Anthropic API to improve/edit an existing Linear ticket.
 * Returns updated ticket content with title and description.
 */
export async function editTicketWithAI(
  apiKey: string,
  currentTitle: string,
  currentDescription: string,
  userRequest: string,
  style: TicketStyle = 'descriptive'
): Promise<TicketContent> {
  const client = new Anthropic({ apiKey })

  const userPrompt = buildTicketEditPrompt(currentTitle, currentDescription, userRequest, style)
  const systemPrompt = getTicketSystemPrompt(style)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Extract text from response
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic API')
  }

  const rawText = textBlock.text.trim()

  // Parse JSON -- handle potential markdown wrapping
  let jsonStr = rawText
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  let ticket: TicketContent
  try {
    ticket = JSON.parse(jsonStr)
  } catch {
    throw new Error(`Failed to parse AI response as JSON:\n${rawText.substring(0, 500)}`)
  }

  if (!ticket.title || !ticket.description) {
    throw new Error('AI response missing required fields (title, description)')
  }

  return ticket
}
