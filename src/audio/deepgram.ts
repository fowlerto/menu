import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export type TranscriptCallback = (text: string, isFinal: boolean) => void

let bridge: EvenAppBridge
let ws: WebSocket | null = null
let apiKey = ''
let onTranscript: TranscriptCallback | null = null
let reconnectAttempts = 0
let running = false
let onStatusChange: ((status: string) => void) | null = null

const MAX_RECONNECT = 3
const RECONNECT_DELAY_MS = 2000

export function initDeepgram(b: EvenAppBridge) {
  bridge = b
}

export function configureDeepgram(key: string) {
  apiKey = key
}

export function onDeepgramStatus(cb: (status: string) => void) {
  onStatusChange = cb
}

function buildWsUrl(): string {
  // encoding + sample_rate required for raw PCM (G2 mic: 16kHz signed 16-bit LE mono)
  return `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&punctuate=true&interim_results=true&endpointing=500`
}

export async function startStreaming(transcriptCb: TranscriptCallback): Promise<void> {
  onTranscript = transcriptCb
  running = true
  reconnectAttempts = 0
  try { await bridge.audioControl(true) } catch { /* simulator may not support audioControl */ }
  openWebSocket()
}

export async function stopStreaming(): Promise<void> {
  running = false
  try { await bridge.audioControl(false) } catch { /* ignore */ }
  closeWebSocket()
}

function openWebSocket() {
  ws = new WebSocket(buildWsUrl(), ['token', apiKey])
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    reconnectAttempts = 0
    onStatusChange?.('connected')
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string)
      const transcript = data.channel?.alternatives?.[0]?.transcript as string | undefined
      if (transcript) onTranscript?.(transcript, data.is_final === true)
    } catch {
      // ignore malformed frames
    }
  }

  ws.onerror = () => {
    onStatusChange?.('error')
  }

  ws.onclose = () => {
    if (!running) return
    if (reconnectAttempts < MAX_RECONNECT) {
      reconnectAttempts++
      onStatusChange?.('reconnecting…')
      setTimeout(openWebSocket, RECONNECT_DELAY_MS)
    } else {
      onStatusChange?.('failed')
      running = false
    }
  }
}

function closeWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close()
  ws = null
}

// Called from the even hub event handler for audio PCM data.
// The SDK types audioPcm as Uint8Array but the runtime value after JSON
// bridge serialization may be a number[] or base64 string.
export function sendAudioData(pcmData: Uint8Array | number[] | string) {
  if (ws?.readyState !== WebSocket.OPEN) return
  const bytes = normalizePcm(pcmData)
  if (bytes.byteLength > 0) ws.send(bytes.buffer as ArrayBuffer)
}

function normalizePcm(data: Uint8Array | number[] | string): Uint8Array {
  if (typeof data === 'string') {
    const binary = atob(data)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  if (Array.isArray(data)) return new Uint8Array(data)
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

export function isStreaming(): boolean {
  return running
}
