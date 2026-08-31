import { setupCounter } from './counter.ts'
import './style.css'

document.querySelector<HTMLDivElement>('#root')!.innerHTML = `
  <div>
    <h1>Rsbuild + TypeScript</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Rsbuild and TypeScript logos to learn more
    </p>
  </div>
`

setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)
