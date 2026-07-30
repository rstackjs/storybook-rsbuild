// The dynamic import forces a split chunk the worker must load through
// `importScripts`, which resolves relative to the worker script, not the
// document — that is the #522 failure path.
import('./worker-probe-chunk')
  .then(({ marker }) => {
    self.postMessage(marker())
  })
  .catch((error) => {
    // A failed chunk load surfaces as an uncaught importScripts error today, so
    // `Worker.onerror` reports it. Post it as well: a rejection would not reach
    // onerror, and the probe would sit on 'pending' until the e2e times out.
    self.postMessage(`chunk load failed: ${error}`)
  })
