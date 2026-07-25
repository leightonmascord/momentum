import { useRegisterSW } from 'virtual:pwa-register/react'
import { useCallback, useEffect } from 'react'
export function ReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r)
    },
    onRegisterError(error) {
      console.error('SW registration error', error)
    },
  })
  // Force reload when the new service worker takes control.
  // This handles the case where autoUpdate activates the new SW
  // but the current page is still using old assets.
  useEffect(() => {
    function onControllerChange() {
      window.location.reload()
    }
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange)
    return () => {
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])
  const close = useCallback(() => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }, [setOfflineReady, setNeedRefresh])
  const handleReload = useCallback(() => {
    updateServiceWorker(true)
  }, [updateServiceWorker])
  if (!offlineReady && !needRefresh) return null
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-lg"
    >
      <div className="text-sm text-slate-700 dark:text-slate-200">
        {needRefresh ? 'New version available — reload to update.' : 'App ready to work offline.'}
      </div>
      {needRefresh && (
        <button
          onClick={handleReload}
          className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
        >
          Reload
        </button>
      )}
      <button
        onClick={close}
        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs"
        aria-label="Close"
      >
        ×
      </button>
    </div>
  )
}