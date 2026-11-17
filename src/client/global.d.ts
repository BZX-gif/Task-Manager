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
    openTaskModal(id?: string | null, options?: { date?: string; inbox?: boolean; prefill?: string; goalId?: string | null; projectId?: string | null; milestoneId?: string | null }): void
    openQuickCapture(options?: { inbox?: boolean; prefill?: string }): void
    closeQuickCapture(): void
    openWeeklyReview(options?: { offset?: number }): void
    openRecoveryModal(options?: { nowMinutes?: number }): void
    closeModal(): void
    openShortcuts(): void
    openDayPlanner(options?: { date?: string }): void
    openGoalModal(id?: string | null): void
    openGoalDetail(id: string): void
    openProjectModal(id?: string | null, options?: { goalId?: string | null; milestoneId?: string | null }): void
    openProjectDetail(id: string): void
    openRoutineModal(id?: string | null): void
    openRescheduleModal(id: string): void
    openFocusRoom(): void
    openScoreInfo(): void
    openCommandPalette(): void
    toggleMission(id: string): boolean
    movePriority(id: string, direction: number): boolean
    toggleScheduleItem(id: string, date?: string): void
    removeFromTop3(id: string): boolean
    runLocalCommand(id: string): void
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
    /** Full-screen "Sir" briefing. Safe to call at any time; idempotent. */
    openBriefing(options?: { auto?: boolean }): any
    closeBriefing(options?: { restoreFocus?: boolean }): void
    openOnboarding(options?: { force?: boolean }): void
    closeOnboarding(): void
    openCalendarImport(): void
    briefingInfo(now?: Date): any
    saveIntention(value: string): string
    speakBriefing(briefing?: any, options?: { notify?: boolean }): boolean
    refreshQuoteInline(): void
  }
  webkitAudioContext?: typeof AudioContext
}
