// Port: @storybook/nextjs-vite/src/export-mocks/headers/cookies.ts
import { fn } from 'storybook/test'
import { headers } from 'storybook-next-rsbuild/headers.mock'
import { RequestCookies } from '../../next-internals'

class RequestCookiesMock extends RequestCookies {
  get = fn(super.get.bind(this)).mockName('next/headers::cookies().get')
  getAll = fn(super.getAll.bind(this)).mockName(
    'next/headers::cookies().getAll',
  )
  has = fn(super.has.bind(this)).mockName('next/headers::cookies().has')
  set = fn(super.set.bind(this)).mockName('next/headers::cookies().set')
  delete = fn(super.delete.bind(this)).mockName(
    'next/headers::cookies().delete',
  )
}

let requestCookiesMock: RequestCookiesMock

export const cookies = fn(() => {
  if (!requestCookiesMock) {
    requestCookiesMock = new RequestCookiesMock(headers())
  }
  return requestCookiesMock
}).mockName('next/headers::cookies()')

const originalRestore = cookies.mockRestore.bind(null)

cookies.mockRestore = () => {
  originalRestore()
  headers.mockRestore()
  requestCookiesMock = new RequestCookiesMock(headers())
}
