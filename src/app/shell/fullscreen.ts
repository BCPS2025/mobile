// Full screen for the presenter (F and the top bar button). Browsers that refuse, or have none,
// leave the page as it is.

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen?.()
  } catch {
    // Not allowed here (an embedded frame, a browser that blocks it): nothing to do.
  }
}
