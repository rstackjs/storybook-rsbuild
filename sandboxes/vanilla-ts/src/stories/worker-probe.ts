// Regression probe for #522: a worker loading an async chunk resolves it only
// when the preview output is flat.
export function runWorkerProbe(element: HTMLElement) {
  element.textContent = 'pending'

  const worker = new Worker(
    new URL('./worker-probe.worker.ts', import.meta.url),
  )

  const report = (text: string) => {
    element.textContent = text
    // One message settles the probe; keep re-renders from piling up threads.
    worker.terminate()
  }

  worker.onmessage = (event) => report(`worker: ${event.data}`)
  worker.onerror = (event) => report(`worker error: ${event.message}`)
}
