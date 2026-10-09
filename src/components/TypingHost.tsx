import { policySnapshot } from '@/lib/app-policy'
import { useTypingEvents } from '@/lib/typing-engine'
import {
  handleTypingCountdown,
  handleTypingDone,
  handleTypingError,
  handleTypingPauseChange,
  handleTypingProgress,
  startSavedTypingSession,
  stopTypingSession,
  toggleTypingSessionPause,
  typingSessionSnapshot,
} from '@/lib/typing-session'

/** Always mounted — global F9/F10/F11 and typing events even when Live is not on screen. */
export function TypingHost() {
  useTypingEvents({
    onCountdown: ({ remainingMs }) => handleTypingCountdown(remainingMs),
    onProgress: handleTypingProgress,
    onDone: handleTypingDone,
    onError: handleTypingError,
    onPauseChange: handleTypingPauseChange,
    onHotkeyStart: () => {
      const rules = policySnapshot()
      if (!rules.hotkeysOn || !rules.typingOn || rules.readOnly) return
      if (!typingSessionSnapshot().running) {
        void startSavedTypingSession().catch((error) =>
          handleTypingError(error instanceof Error ? error.message : String(error)),
        )
      }
    },
    onHotkeyCancel: () => void stopTypingSession(),
    onHotkeyPause: () => void toggleTypingSessionPause(),
  })

  return null
}
