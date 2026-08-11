import { useState } from 'react'
import { loadSettings, saveSettings } from '../../lib/settings-store'
import { Button } from './Button'
import { Modal } from './Modal'
import { VERSION } from '../../lib/version'

/**
 * Dev build preview banner.
 *
 * Renders an undismissable top banner whenever the user has enabled dev mode in
 * Settings. The banner offers a "Push to Global" action that surfaces a
 * confirmation modal — the actual deploy is performed out-of-band (this app is
 * a static build; "push" in this context is a build-and-deploy step the user
 * triggers locally, not something the browser can execute directly).
 */
export function DevBanner() {
  const [settings, setSettings] = useState(loadSettings)
  const [pushModalOpen, setPushModalOpen] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushDone, setPushDone] = useState(false)

  if (!settings.devMode) return null

  const handlePushToGlobal = async () => {
    setPushing(true)
    try {
      // Best-effort: if a local dev hook is present, ping it so the developer
      // running the build server gets a notification. No-op in production.
      await fetch('/__dev_push__', { method: 'POST' }).catch(() => null)
      setPushDone(true)
    } finally {
      setPushing(false)
      setPushModalOpen(false)
    }
  }

  const handleDisableDevMode = () => {
    const updated = { ...settings, devMode: false }
    saveSettings(updated)
    setSettings(updated)
    setPushModalOpen(false)
  }

  return (
    <>
      <div className="sticky top-0 z-50 w-full bg-amber-500 px-4 py-2 shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded bg-amber-700 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
              Dev Build v{VERSION}
            </span>
            <span className="text-sm font-medium text-amber-950">
              Preview Mode — changes are not yet pushed to global
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="border-amber-700 bg-amber-100 text-amber-900 hover:bg-amber-200"
              onClick={() => setPushModalOpen(true)}
            >
              Testing Done — Push to Global
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="border-amber-700 bg-amber-100 text-amber-900 hover:bg-amber-200"
              onClick={handleDisableDevMode}
              title="Turn off Dev Mode and dismiss this banner"
            >
              Disable
            </Button>
          </div>
        </div>
      </div>

      <Modal open={pushModalOpen} onClose={() => { if (!pushing) setPushModalOpen(false) }} title="Push to Global">
        <div className="space-y-4">
          <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            This will build the current code and deploy it to the live site at <strong>momentum-study.github.io/momentum</strong>.
          </div>
          <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            Make sure you have tested all changes thoroughly before pushing.
          </div>
          {pushDone && (
            <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
              Build and deploy initiated. Check the terminal for progress.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setPushModalOpen(false)}
              disabled={pushing}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handlePushToGlobal}
              disabled={pushing}
            >
              {pushing ? 'Building & Deploying...' : 'Build & Deploy'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
