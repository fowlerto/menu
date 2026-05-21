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
  const content = formatMinimalLine()

  if (!pageCreated) {
    await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [minimalContainer(content)],
    }))
    pageCreated = true
  } else {
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [minimalContainer(content)],
    }))
  }

  startClock()
}

async function showMenu() {
  stopClock()
  state = 'menu'
  await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: 28,
      borderWidth: 0, paddingLength: 4,
      containerID: 2, containerName: 'header',
      content: formatMenuHeader(),
      isEventCapture: 0,
    })],
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

function minimalContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 1, containerName: 'minimal',
    content, isEventCapture: 1,
  })
}


// ── Clock ──────────────────────────────────────────────────────────────────────

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatMinimalLine(): string {
  const time = formatTime()
  return ' '.repeat(Math.max(0, 34 - time.length)) + time
}

function formatMenuHeader(): string {
  const left = 'Smart Dashboard'
  const time = formatTime()
  return left + ' '.repeat(Math.max(1, 34 - left.length - time.length)) + time
}

function startClock() {
  stopClock()
  clockInterval = setInterval(() => {
    if (state === 'minimal') {
      bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, content: formatMinimalLine() }))
    } else if (state === 'menu') {
      bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, content: formatMenuHeader() }))
    }
  }, 60000)
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null }
}
