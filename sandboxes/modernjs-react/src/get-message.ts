export async function getMessage() {
  const response = await fetch('/bff-api/lambda')

  if (!response.ok) {
    throw new Error(`Failed to load message: ${response.status}`)
  }

  return response.json() as Promise<{ message: string }>
}
