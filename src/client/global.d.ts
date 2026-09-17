/**
 * Ambient declarations for the client bundle.
 *
 * The client is plain JavaScript that runs in the browser; these declarations
 * describe the few globals the app installs/consumes so `tsc --checkJs` can
 * verify the rest of the code without per-file casts.
 */

interface Window {
  /** Small API surface used by inline handlers inside the rendered views. */
  CC: {
    version: string
    switchView(view: string): void
    refreshAll(): void
    refreshCurrentView(delay?: number): void
    openTaskModal(id?: string | null): void
    openQuickCapture(options?: { inbox?: boolean; prefill?: string }): void
    closeQuickCapture(): void
    openWeeklyReview(options?: { offset?: number }): void
    openRecoveryModal(options?: { nowMinutes?: number }): void
    closeModal(): void
    /** no arg = picker · task id = start immediately · running session = bring it back */
    openFocusMode(taskId?: string | null): void
    pauseFocus(): void
    resumeFocus(): void
    stopFocus(options?: { quiet?: boolean }): void
    completeFocus(): void
    hasRunningSession(): boolean
    addTaskToTop3(taskId: string): { ok: boolean; reason?: string; ids: string[] }
    streakInfo(): { current: number; best: number; recent: Array<{ dateKey: string; score: number; isToday: boolean; status: string }> }
    disciplineInfo(): any
    titles(): any
    todayKey(date?: Date): string
    getState(): any
    askAI(text: string): void
    handleChatKey(event: KeyboardEvent): void
    toggleMobileNav(): void
    checkReminders(): unknown[]
    refreshQuoteInline(): void
  }
  webkitAudioContext?: typeof AudioContext
}
