import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { RebuildPageContainer, TextContainerProperty, TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { startStreaming, stopStreaming, isStreaming } from '../audio/deepgram.ts'

const REMIND_URL = 'https://even-calendar.fowlerto.workers.dev/remind'

type ReminderState = 'idle' | 'recording' | 'confirm'

let bridge: EvenAppBridge
let reminderState: ReminderState = 'idle'
let finalTranscript = ''

export function initReminder(b: EvenAppBridge) {
  bridge = b
}

export function getReminderState(): ReminderState {
  return reminderState
}

function makeContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 1, containerName: 'reminder',
    content, isEventCapture: 1,
  })
}

function setText(text: string) {
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, content: text }))
}

export async function enterReminder(): Promise<void> {
  reminderState = 'idle'
  finalTranscript = ''
  await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [makeContainer('Tap to record reminder\n\nDouble-tap to go back')],
  }))
}

export async function exitReminder(): Promise<void> {
  if (isStreaming()) await stopStreaming()
  reminderState = 'idle'
  finalTranscript = ''
}

// isClick / isScroll only — double-tap is handled globally by main.ts (exits to menu)
export async function handleReminderInput(isClick: boolean, isScroll: boolean): Promise<void> {
  if (reminderState === 'idle') {
    if (isClick) {
      reminderState = 'recording'
      finalTranscript = ''
      setText('Recording...\n\n(tap to stop)')
      await startStreaming((transcript, isFinal) => {
        if (isFinal) finalTranscript = transcript
        setText(`${transcript}\n\n(tap to stop)`)
      })
    }
    return
  }

  if (reminderState === 'recording') {
    if (isClick) {
      await stopStreaming()
      reminderState = 'confirm'
      setText(`"${finalTranscript}"\n\nTap=save  Swipe=retry  Dbl=back`)
    }
    return
  }

  if (reminderState === 'confirm') {
    if (isClick) {
      setText('Saving reminder...')
      try {
        await fetch(REMIND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: finalTranscript }),
        })
        reminderState = 'idle'
        setText('Reminder saved!\n\nTap to record another\nDouble-tap to go back')
      } catch {
        reminderState = 'idle'
        setText('Failed to save.\nTap to try again.\n\nDouble-tap to go back')
      }
      return
    }

    if (isScroll) {
      reminderState = 'idle'
      finalTranscript = ''
      setText('Tap to record reminder\n\nDouble-tap to go back')
    }
  }
}
