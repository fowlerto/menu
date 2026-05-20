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

const DEEPGRAM_KEY = import.meta.env.VITE_DEEPGRAM_KEY as string

type AppState = 'minimal' | 'menu' | 'calendar' | 'reminder'

let state: AppState = 'minimal'
let pageCreated = false
let clockInterval: ReturnType<typeof setInterval> | null = null

const MENU_ITEMS = ['Calendar', 'Add Reminder']

const bridge: EvenAppBridge = await waitForEvenAppBridge()
initDeepgram(bridge)
configureDeepgram(DEEPGRAM_KEY)
initCalendar(bridge)
initReminder(bridge)

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
  const isScroll =
    type === OsEventTypeList.SCROLL_TOP_EVENT ||
    type === OsEventTypeList.SCROLL_BOTTOM_EVENT

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
    containerTotalNum: 1,
    listObject: [new ListContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: 288,
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
}

async function launchModule(idx: number) {
  if (idx === 0) {
    state = 'calendar'
    await enterCalendar()
  } else {
    state = 'reminder'
    await enterReminder()
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

function formatMinimalLine(): string {
  const left = 'Smart Menu'
  const right = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  // G2 display ~34 chars per line at default font size
  const spaces = Math.max(2, 34 - left.length - right.length)
  return left + ' '.repeat(spaces) + right
}

function startClock() {
  stopClock()
  clockInterval = setInterval(() => {
    if (state === 'minimal') {
      bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, content: formatMinimalLine() }))
    }
  }, 60000)
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null }
}
