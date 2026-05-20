import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { RebuildPageContainer, TextContainerProperty, TextContainerUpgrade } from '@evenrealities/even_hub_sdk'

const WORKER_URL = 'https://even-calendar.fowlerto.workers.dev/calendar'

let bridge: EvenAppBridge

export function initCalendar(b: EvenAppBridge) {
  bridge = b
}

function makeContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 1, containerName: 'calendar',
    content, isEventCapture: 1,
  })
}

function setText(text: string) {
  bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, content: text }))
}

export async function enterCalendar(): Promise<void> {
  await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [makeContainer('Loading calendar...')],
  }))
  await fetchAndDisplay()
}

async function fetchAndDisplay(): Promise<void> {
  try {
    const res = await fetch(WORKER_URL)
    if (!res.ok) {
      setText('No calendar data.\n\nDouble-tap to go back.')
      return
    }
    const data = await res.json() as {
      events?: Array<{ start: string; end: string; title: string }>
    }
    const events = data.events ?? []
    if (events.length === 0) {
      setText('No events today.\n\nDouble-tap to go back.')
      return
    }

    const normalize = (s: string) => s.replace(/\s/g, ' ')
    const lines = events.map(e => {
      const startTime = e.start.split(' at ')[1] ?? ''
      const endTime = e.end.split(' at ')[1] ?? ''
      const isAllDay =
        normalize(startTime).includes('12:00 AM') &&
        normalize(endTime).includes('11:59 PM')
      const label = isAllDay ? 'All Day' : startTime
      return `${label}  ${e.title}`
    })

    setText(lines.join('\n') + '\n\nDouble-tap to go back.')
  } catch {
    setText('Failed to load calendar.\n\nDouble-tap to go back.')
  }
}
