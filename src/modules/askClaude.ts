import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { RebuildPageContainer, TextContainerProperty, TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { startStreaming, stopStreaming, isStreaming } from '../audio/deepgram.ts'
import { measureTextWrap } from '@evenrealities/pretext'

const MODEL       = 'claude-sonnet-4-6'
const MAX_TOKENS  = 500
const SILENCE_MS  = 2000
const MAX_HISTORY = 3   // conversation pairs before reset

// Display geometry — same as Even-Claude (y=28 header row is absent here, so full height)
const INNER_W    = 560                        // 576 - 2×8 padding
const LINE_H     = 27
const INNER_H    = 288 - 2 * 8               // 272
const MAX_LINES  = Math.floor(INNER_H / LINE_H)  // 10

const SYSTEM_PROMPT =
  'You are an AI assistant on smart glasses. Keep answers under 200 words. ' +
  'Be direct and concise. No markdown, no bullet symbols, no headers. ' +
  'Use short paragraphs separated by blank lines. ' +
  'For any question about current events, people, news, sports, prices, or facts that could have changed since 2024, use web_search first. ' +
  'Never say "let me search" or mention searching. Just answer.'

type AskState = 'idle' | 'listening' | 'thinking' | 'response' | 'error'

interface HistoryMsg { role: 'user' | 'assistant'; content: string }

let bridge: EvenAppBridge
let anthropicKey    = ''
let askState: AskState = 'idle'
let history: HistoryMsg[] = []
let historyCount    = 0
let pages: string[] = []
let page            = 0
let revealDone      = false
let reqId           = 0
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let liveFinal       = ''
let liveInterim     = ''

export function initAskClaude(b: EvenAppBridge, key: string) {
  bridge       = b
  anthropicKey = key
}

function setText(text: string) {
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, content: text }))
}

const IDLE_MSG = 'Ask Claude\n\nTap to speak\nDbl-tap to go back'

export async function enterAskClaude(): Promise<void> {
  askState     = 'idle'
  history      = []
  historyCount = 0
  pages        = []
  page         = 0
  revealDone   = false
  liveFinal    = ''
  liveInterim  = ''
  await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: 288,
      borderWidth: 0, paddingLength: 8,
      containerID: 1, containerName: 'askClaude',
      content: IDLE_MSG,
      isEventCapture: 1,
    })],
  }))
}

export async function exitAskClaude(): Promise<void> {
  clearSilenceTimer()
  if (isStreaming()) await stopStreaming()
  reqId++  // cancel any in-flight request
  askState    = 'idle'
  liveFinal   = ''
  liveInterim = ''
}

export async function handleAskClaudeInput(
  isClick: boolean,
  isScrollUp: boolean,
  isScrollDown: boolean,
): Promise<void> {
  if (isClick) {
    if (askState === 'idle' || askState === 'error') {
      await startListening()
    } else if (askState === 'listening') {
      await finishListening()
    } else if (askState === 'response' && revealDone) {
      await startListening()
    }
    return
  }
  if (askState === 'response' && revealDone) {
    if (isScrollDown) await showPage(page + 1)
    if (isScrollUp)   await showPage(page - 1)
  }
}


// ── Mic / transcript ──────────────────────────────────────────────────────────

function clearSilenceTimer() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
}

function resetSilenceTimer() {
  clearSilenceTimer()
  silenceTimer = setTimeout(async () => {
    if (askState === 'listening' && liveFinal.trim()) await finishListening()
  }, SILENCE_MS)
}

async function startListening() {
  liveFinal   = ''
  liveInterim = ''
  askState    = 'listening'
  clearSilenceTimer()
  setText('Recording...\nSpeak your question.\n\nPause to send or tap to stop.')

  await startStreaming((text, isFinal) => {
    if (isFinal) {
      if (text) { liveFinal += (liveFinal ? ' ' : '') + text; resetSilenceTimer() }
      liveInterim = ''
    } else {
      liveInterim = text
    }
    if (askState !== 'listening') return
    const full      = (liveFinal + (liveInterim ? ' ' + liveInterim : '')).trim()
    const truncated = full.length > 100 ? '...' + full.slice(-97) : full
    setText(full
      ? `"${truncated}"\n\nPause to send or tap to stop.`
      : 'Recording...\nSpeak your question.\n\nPause to send or tap to stop.')
  })
}

async function finishListening() {
  clearSilenceTimer()
  const transcript = (liveFinal + (liveInterim ? ' ' + liveInterim : '')).trim()
  liveFinal   = ''
  liveInterim = ''
  if (isStreaming()) await stopStreaming()

  if (!transcript) {
    askState = 'error'
    setText('No speech detected.\nTap to try again.\n\nDbl-tap to go back')
    setTimeout(() => { if (askState === 'error') { askState = 'idle'; setText(IDLE_MSG) } }, 3000)
    return
  }

  await sendToClaude(transcript)
}


// ── Claude API ────────────────────────────────────────────────────────────────

async function sendToClaude(question: string) {
  if (historyCount >= MAX_HISTORY) { history = []; historyCount = 0 }

  pages      = []
  page       = 0
  revealDone = false
  askState   = 'thinking'
  const preview = question.length > 50 ? question.slice(0, 50) + '...' : question
  setText(`You: "${preview}"\n\nAsking Claude...`)

  const id = ++reqId

  const msgs = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ]

  try {
    const answer = await streamClaude(msgs, id)
    if (id !== reqId) return

    history.push({ role: 'user', content: question })
    history.push({ role: 'assistant', content: answer })
    historyCount++

    pages    = paginate(answer)
    page     = 0
    askState = 'response'
    await showPage(0)
    revealDone = true
  } catch (err: any) {
    if (id !== reqId) return
    askState = 'error'
    setText(`Error: ${(err as Error).message}\n\nTap to retry`)
    setTimeout(() => { if (askState === 'error') { askState = 'idle'; setText(IDLE_MSG) } }, 5000)
  }
}

async function streamClaude(
  msgs: { role: string; content: string }[],
  id: number,
): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: msgs,
      stream: true,
    }),
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error((body as any)?.error?.message ?? `API error ${resp.status}`)
  }
  if (!resp.body) throw new Error('Streaming not supported')

  const reader    = resp.body.getReader()
  const decoder   = new TextDecoder()
  let accumulated = ''
  let buf         = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()!
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue
      let evt: any
      try { evt = JSON.parse(raw) } catch { continue }
      if (evt.type === 'error') throw new Error(evt.error?.message ?? 'Stream error')
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        accumulated += evt.delta.text
        if (id === reqId && askState === 'thinking') {
          const preview = accumulated.length > 180 ? accumulated.slice(0, 180) + '...' : accumulated
          setText(preview)
        }
      }
    }
  }

  return accumulated.trim()
}


// ── Pagination ────────────────────────────────────────────────────────────────

function paginate(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return ['']

  // Single page — fits without indicator
  if (measureTextWrap(trimmed, INNER_W).lineCount <= MAX_LINES) return [trimmed]

  // Multi-page: reserve 2 lines for \n\n[N/M]
  const maxContent = MAX_LINES - 2
  const result: string[] = []
  let remaining = trimmed

  while (remaining.length > 0) {
    let lo = 1, hi = remaining.length, best = 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (measureTextWrap(remaining.slice(0, mid), INNER_W).lineCount <= maxContent) {
        best = mid; lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    let split = best
    if (split < remaining.length) {
      while (split > 0 && !/\s/.test(remaining[split - 1])) split--
      if (split === 0) split = best
    }
    result.push(remaining.slice(0, split).trim())
    remaining = remaining.slice(split).trim()
  }

  return result.length ? result : [trimmed]
}

async function showPage(idx: number) {
  if (!pages.length) return
  page = Math.max(0, Math.min(idx, pages.length - 1))
  const suffix = pages.length > 1 ? `\n\n[${page + 1}/${pages.length}]` : ''
  setText(pages[page] + suffix)
}
