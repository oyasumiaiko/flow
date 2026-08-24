import { useEffect } from 'react'

// https://github.com/excalidraw/excalidraw/blob/7eaf47c9d41a33a6230d8c3a16b5087fc720dcfb/src/packages/excalidraw/index.tsx#L66
export function useDisablePinchZooming(win?: Window) {
  useEffect(() => {
    const _win = win ?? window
    // A document-level preventDefault for every touchmove also disables native
    // one-finger scrolling on Android. Only cancel an actual multi-touch pinch.
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2) return
      event.preventDefault()
    }

    _win.document.addEventListener('touchmove', handleTouchMove, {
      passive: false,
    })

    return () => {
      _win.document.removeEventListener('touchmove', handleTouchMove)
    }
  }, [win])
}
