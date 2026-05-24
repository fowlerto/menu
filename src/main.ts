import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { getTextWidth } from '@evenrealities/pretext'
import { initDeepgram, configureDeepgram, sendAudioData } from './audio/deepgram.ts'
import { initCalendar, enterCalendar } from './modules/calendar.ts'
import {
  initReminder, enterReminder, exitReminder,
  handleReminderInput, getReminderState,
} from './modules/reminder.ts'
import { initAskClaude, enterAskClaude, exitAskClaude, handleAskClaudeInput } from './modules/askClaude.ts'

const DEEPGRAM_KEY  = import.meta.env.VITE_DEEPGRAM_KEY  as string
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY as string

type AppState = 'minimal' | 'menu' | 'calendar' | 'reminder' | 'askClaude'

let state: AppState = 'minimal'
let pageCreated = false
let clockInterval: ReturnType<typeof setInterval> | null = null
let lastMinimalTimeW = 0
let lastMenuTimeW = 0

const TIME_PAD = 4

function timeDims(time: string): { x: number; w: number } {
  const w = getTextWidth(time) + 2 * TIME_PAD
  return { x: 576 - w, w }
}

const MENU_ITEMS = ['Calendar', 'Add Reminder', 'Ask Claude']

const bridge: EvenAppBridge = await waitForEvenAppBridge()
initDeepgram(bridge)
configureDeepgram(DEEPGRAM_KEY)
initCalendar(bridge)
initReminder(bridge)
initAskClaude(bridge, ANTHROPIC_KEY)

await showMinimal()


// ── Event routing ──────────────────────────────────────────────────────────────

bridge.onEvenHubEvent(async (event) => {
  if (event.audioEvent?.audioPcm) {
    sendAudioData(event.audioEvent.audioPcm)
    return
  }

  // Lifecycle events — clean up and return
  const sys = event.sysEvent
  if (sys) {
    switch (sys.eventType) {
      case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      case OsEventTypeList.SYSTEM_EXIT_EVENT:
        await exitReminder()
        await exitAskClaude()
        return
      case OsEventTypeList.IMU_DATA_REPORT:
        return
    }
  }

  // Resolve event type from whichever sub-event is present
  const rawType = event.textEvent?.eventType
    ?? event.listEvent?.eventType
    ?? event.sysEvent?.eventType
  const type = OsEventTypeList.fromJson(rawType)

  // Simulator sends sysEvent with undefined eventType for single-tap
  const isClick = type === OsEventTypeList.CLICK_EVENT || rawType === undefined
  const isDoubleClick = type === OsEventTypeList.DOUBLE_CLICK_EVENT
  const isScrollUp   = type === OsEventTypeList.SCROLL_TOP_EVENT
  const isScrollDown = type === OsEventTypeList.SCROLL_BOTTOM_EVENT
  const isScroll     = isScrollUp || isScrollDown

  // ── Minimal ────────────────────────────────────────────────────────────────
  if (state === 'minimal') {
    if (isClick) await showMenu()
    return
  }

  // ── Menu ───────────────────────────────────────────────────────────────────
  if (state === 'menu') {
    if (isDoubleClick) {
      await showMinimal()
      return
    }
    if (isClick) {
      const idx = event.listEvent?.currentSelectItemIndex ?? 0
      await launchModule(idx)
    }
    return
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  if (state === 'calendar') {
    if (isDoubleClick) await showMenu()
    return
  }

  // ── Reminder ───────────────────────────────────────────────────────────────
  if (state === 'reminder') {
    // Double-tap always exits to menu except when in 'confirm' (swipe=retry there)
    if (isDoubleClick && getReminderState() !== 'confirm') {
      await exitReminder()
      await showMenu()
      return
    }
    await handleReminderInput(isClick, isScroll)
    return
  }

  // ── Ask Claude ─────────────────────────────────────────────────────────────
  if (state === 'askClaude') {
    if (isDoubleClick) {
      await exitAskClaude()
      await showMenu()
      return
    }
    await handleAskClaudeInput(isClick, isScrollUp, isScrollDown)
  }
})


// ── Views ──────────────────────────────────────────────────────────────────────

async function showMinimal() {
  stopClock()
  state = 'minimal'
  const time = formatTime()
  const { x, w } = timeDims(time)

  const containers = {
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0, yPosition: 0, width: 576, height: 288,
        borderWidth: 0, paddingLength: 0,
        containerID: 1, containerName: 'minEvt',
        content: ' ', isEventCapture: 1,
      }),
      new TextContainerProperty({
        xPosition: x, yPosition: 0, width: w, height: 28,
        borderWidth: 0, paddingLength: TIME_PAD,
        containerID: 2, containerName: 'minTime',
        content: time, isEventCapture: 0,
      }),
    ],
  }

  if (!pageCreated) {
    await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containers))
    pageCreated = true
  } else {
    await bridge.rebuildPageContainer(new RebuildPageContainer(containers))
  }

  lastMinimalTimeW = w
  startClock()
}

async function showMenu() {
  stopClock()
  state = 'menu'
  const time = formatTime()
  const { x, w } = timeDims(time)

  await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [
      new TextContainerProperty({
        xPosition: 0, yPosition: 0, width: x, height: 28,
        borderWidth: 0, paddingLength: 4,
        containerID: 2, containerName: 'header',
        content: 'Smart Dashboard',
        isEventCapture: 0,
      }),
      new TextContainerProperty({
        xPosition: x, yPosition: 0, width: w, height: 28,
        borderWidth: 0, paddingLength: TIME_PAD,
        containerID: 3, containerName: 'menuTime',
        content: time,
        isEventCapture: 0,
      }),
    ],
    listObject: [new ListContainerProperty({
      xPosition: 0, yPosition: 28, width: 576, height: 260,
      borderWidth: 0, paddingLength: 8,
      containerID: 1, containerName: 'menu',
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: MENU_ITEMS.length,
        itemWidth: 576,
        isItemSelectBorderEn: 1,
        itemName: MENU_ITEMS,
      }),
    })],
  }))

  lastMenuTimeW = w
  startClock()
}

async function launchModule(idx: number) {
  if (idx === 0) {
    state = 'calendar'
    await enterCalendar()
  } else if (idx === 1) {
    state = 'reminder'
    await enterReminder()
  } else {
    state = 'askClaude'
    await enterAskClaude()
  }
}

// ── Clock ──────────────────────────────────────────────────────────────────────

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function startClock() {
  stopClock()
  clockInterval = setInterval(async () => {
    const time = formatTime()
    const { w } = timeDims(time)
    if (state === 'minimal') {
      if (w !== lastMinimalTimeW) {
        await showMinimal()
      } else {
        bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, content: time }))
      }
    } else if (state === 'menu') {
      if (w !== lastMenuTimeW) {
        await showMenu()
      } else {
        bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 3, content: time }))
      }
    }
  }, 60000)
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null }
}
