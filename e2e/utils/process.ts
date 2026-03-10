import kill from 'tree-kill'

export async function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
): Promise<void> {
  if (!pid) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    kill(pid, signal, (error) => {
      if (
        !error ||
        ('code' in error && error.code === 'ESRCH') ||
        isIgnorableWindowsKillError(error)
      ) {
        resolve()
        return
      }

      reject(error)
    })
  })
}

function isIgnorableWindowsKillError(error: Error): boolean {
  if (process.platform !== 'win32') {
    return false
  }

  return (
    error.message.includes('There is no running instance of the task.') ||
    error.message.includes('The operation attempted is not supported.')
  )
}
