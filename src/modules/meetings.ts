import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { RebuildPageContainer, TextContainerProperty, TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { startStreaming, stopStreaming, isStreaming } from '../audio/deepgram.ts'
import { shouldGenerateCue, generateCue } from '../ai/claude.ts'

type MeetingState = 'idle' | 'active'

let bridge: EvenAppBridge
let meetingState: MeetingState = 'idle'
let fullTranscript = ''
let transcriptWindow = ''
let cueInterval: ReturnType<typeof setInterval> | null = null
let cueDisplayTimeout: ReturnType<typeof setTimeout> | null = null

const CUE_CHECK_INTERVAL_MS = 20000  // check for auto-cue every 20s
const CUE_HOLD_MS = 8000             // show cue for 8s then return to listening

export function initMeetings(b: EvenAppBridge) {
  bridge = b
}

function makeContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 1, containerName: 'meetings',
    content, isEventCapture: 1,
  })
}

function setText(text: string) {
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, content: text }))
}

function showListening() {
  setText('Listening...\n\n(tap for cue, dbl=end)')
}

export async function enterMeetings(): Promise<void> {
  meetingState = 'idle'
  fullTranscript = ''
  transcriptWindow = ''
  await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [makeContainer('Tap to start meeting\n\nDouble-tap to go back')],
  }))
}

export async function exitMeetings(): Promise<void> {
  stopCuePipeline()
  clearCueTimeout()
  if (isStreaming()) await stopStreaming()
  meetingState = 'idle'
  fullTranscript = ''
  transcriptWindow = ''
}

export async function handleMeetingsInput(isClick: boolean): Promise<void> {
  if (meetingState === 'idle' && isClick) {
    meetingState = 'active'
    fullTranscript = ''
    transcriptWindow = ''
    showListening()
    await startStreaming((text, isFinal) => {
      if (!isFinal) return
      fullTranscript += text + ' '
      transcriptWindow += text + ' '
      setText(text + '\n\n(tap for cue, dbl=end)')
    })
    startCuePipeline()
    return
  }

  if (meetingState === 'active' && isClick) {
    await triggerManualCue()
  }
}

function startCuePipeline() {
  stopCuePipeline()
  cueInterval = setInterval(async () => {
    const snippet = transcriptWindow.trim()
    if (snippet.length < 40) return
    transcriptWindow = ''
    if (!(await shouldGenerateCue(snippet))) return
    const cue = await generateCue(snippet)
    if (cue && meetingState === 'active') showCue(cue)
  }, CUE_CHECK_INTERVAL_MS)
}

function stopCuePipeline() {
  if (cueInterval) { clearInterval(cueInterval); cueInterval = null }
}

function clearCueTimeout() {
  if (cueDisplayTimeout) { clearTimeout(cueDisplayTimeout); cueDisplayTimeout = null }
}

function showCue(cue: { type: string; text: string }) {
  clearCueTimeout()
  setText(`[${cue.type.toUpperCase()}]\n${cue.text}\n\n(tap for cue, dbl=end)`)
  cueDisplayTimeout = setTimeout(() => {
    if (meetingState === 'active') showListening()
  }, CUE_HOLD_MS)
}

async function triggerManualCue() {
  const snippet = fullTranscript.slice(-800).trim()
  if (snippet.length < 20) {
    setText('Keep talking — not enough transcript yet\n\n(tap for cue, dbl=end)')
    cueDisplayTimeout = setTimeout(() => {
      if (meetingState === 'active') showListening()
    }, 2000)
    return
  }

  clearCueTimeout()
  setText('Getting cue...\n\n(tap for cue, dbl=end)')
  const cue = await generateCue(snippet)
  if (cue && meetingState === 'active') {
    showCue(cue)
  } else if (meetingState === 'active') {
    setText('No cue generated.\n\n(tap for cue, dbl=end)')
    cueDisplayTimeout = setTimeout(showListening, 2000)
  }
}
