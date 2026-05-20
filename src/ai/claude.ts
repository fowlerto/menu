const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-6'

let anthropicKey = ''

export function configureAI(key: string) {
  anthropicKey = key
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': anthropicKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

const THRESHOLD_SYSTEM =
  'Respond YES if this meeting transcript contains a question being asked, an unclear or technical claim, a named person, or a notable topic worth an AI cue. Respond NO for filler conversation. Reply with one word.'

export async function shouldGenerateCue(transcript: string): Promise<boolean> {
  if (!anthropicKey) return false
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 10,
        system: THRESHOLD_SYSTEM,
        messages: [{ role: 'user', content: transcript }],
      }),
    })
    const data = await resp.json()
    const text: string = data.content?.[0]?.text ?? ''
    return text.trim().toUpperCase().startsWith('YES')
  } catch {
    return false
  }
}

const CUE_SYSTEM = `You are a real-time AI meeting assistant on smart glasses. Generate ONE concise cue (max 200 chars) based on the transcript.

Available cue types: probe (follow-up question to ask), concept (term explanation), bio (person background), answer (direct answer), reference (fact/statistic)

Format:
TYPE: <type>
CUE: <cue text>`

export async function generateCue(transcript: string): Promise<{ type: string; text: string } | null> {
  if (!anthropicKey) return null
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 150,
        system: CUE_SYSTEM,
        messages: [{ role: 'user', content: transcript }],
      }),
    })
    const data = await resp.json()
    if (data.error) return null
    const textBlock = (data.content ?? []).find(
      (b: { type: string }) => b.type === 'text',
    ) as { text: string } | undefined
    if (!textBlock) return null
    return parseCueResponse(textBlock.text)
  } catch {
    return null
  }
}

function parseCueResponse(text: string): { type: string; text: string } | null {
  const typeMatch = text.match(/TYPE:\s*(\w+)/i)
  const cueMatch = text.match(/CUE:\s*(.+)/is)
  if (!typeMatch || !cueMatch) return null
  return { type: typeMatch[1].toLowerCase(), text: cueMatch[1].trim().slice(0, 200) }
}
