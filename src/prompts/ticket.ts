/**
 * System prompt and user prompt templates for AI-powered Linear ticket generation.
 */

export type TicketStyle = 'tldr' | 'descriptive' | 'detailed'

const TICKET_STYLE_GUIDELINES: Record<TicketStyle, string> = {
  tldr: `TLDR Style Guidelines:
- Keep description VERY brief and to the point (2-4 sentences max)
- Focus on the essential "what" and "why" only
- Skip detailed acceptance criteria unless critical
- No extensive context or background
- Title should be concise and action-oriented
- Example length: 50-150 words total`,

  descriptive: `Descriptive Style Guidelines:
- Balanced description with clear structure
- Include context/background when relevant
- Include acceptance criteria for features/tasks
- Include reproduction steps for bugs
- Use markdown formatting (headers, lists)
- Example length: 150-300 words`,

  detailed: `Detailed Style Guidelines:
- Comprehensive description with extensive context
- Detailed acceptance criteria with specific requirements
- Technical implementation details and considerations
- Codebase-specific references (file paths, function names, patterns)
- Architecture decisions and trade-offs
- Testing requirements and edge cases
- Example length: 300-600 words`
}

export function getTicketSystemPrompt(style: TicketStyle = 'descriptive'): string {
  const styleGuidelines = TICKET_STYLE_GUIDELINES[style]

  return `You are an expert at writing clear, actionable Linear tickets. You help users create well-structured issue descriptions with proper context, acceptance criteria, and technical details.

You MUST return a valid JSON object with these fields:
- "title": concise, descriptive title (max 80 characters, no period at end)
- "description": well-formatted markdown description

${styleGuidelines}

Guidelines:
- Titles should be action-oriented and specific (e.g., "Add dark mode toggle" not "Dark mode")
- Descriptions should be clear and structured, using markdown formatting
- Use proper markdown formatting (headers, lists, code blocks where appropriate)
${style === 'detailed' ? '- Include specific codebase references, file paths, and implementation details when relevant' : ''}

Return ONLY a JSON object. No markdown wrapping, no explanation.`
}

export function buildTicketCreatePrompt(
  userInput: string,
  style: TicketStyle = 'descriptive',
  context?: string
): string {
  let prompt = `Create a Linear ticket based on the following user input:\n\n${userInput}`
  
  if (context) {
    prompt += `\n\nAdditional context:\n${context}`
  }
  
  const styleInstructions = {
    tldr: 'Generate a brief, TLDR-style ticket - keep it short and sweet, focusing only on essentials.',
    descriptive: 'Generate a well-structured ticket with balanced detail - include context, acceptance criteria, and clear structure.',
    detailed: 'Generate a comprehensive, detailed ticket - include extensive context, specific codebase references, technical implementation details, and thorough acceptance criteria.'
  }
  
  prompt += `\n\n${styleInstructions[style]}`
  
  return prompt
}

export function buildTicketEditPrompt(
  currentTitle: string,
  currentDescription: string,
  userRequest: string,
  style: TicketStyle = 'descriptive'
): string {
  const styleInstructions = {
    tldr: 'Keep the updated ticket brief and TLDR-style - short and sweet, essentials only.',
    descriptive: 'Maintain a balanced, well-structured ticket with appropriate detail.',
    detailed: 'Make the ticket comprehensive and detailed - include extensive context, codebase references, and thorough technical details.'
  }

  return `Improve and update the following Linear ticket based on the user's request.

Current ticket:
Title: ${currentTitle}
Description:
${currentDescription}

User's request: ${userRequest}

${styleInstructions[style]}

Update the ticket to address the user's request while maintaining clarity and structure. Return the updated title and description as JSON.`
}
