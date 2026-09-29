const deleteIndexedDatabase = (name: string) => new Promise<void>((resolve) => {
  const request = window.indexedDB.deleteDatabase(name)
  request.onsuccess = () => resolve()
  request.onerror = () => resolve()
  request.onblocked = () => resolve()
})

const clearIndexedDatabases = async () => {
  const databaseApi = window.indexedDB
  if (!databaseApi || typeof databaseApi.databases !== 'function') return

  const databases = await databaseApi.databases()
  await Promise.allSettled(
    databases.map(database => (
      database.name
        ? deleteIndexedDatabase(database.name)
        : Promise.resolve()
    ))
  )
}

const clearCacheStorage = async () => {
  if (!('caches' in window)) return

  const keys = await window.caches.keys()
  await Promise.allSettled(keys.map(key => window.caches.delete(key)))
}

const unregisterServiceWorkers = async () => {
  if (!('serviceWorker' in navigator)) return

  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.allSettled(registrations.map(registration => registration.unregister()))
}

export const clearBrowserCache = async () => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.clear()
  } catch {}

  try {
    window.sessionStorage.clear()
  } catch {}

  await Promise.allSettled([
    clearCacheStorage(),
    clearIndexedDatabases(),
    unregisterServiceWorkers()
  ])
}
