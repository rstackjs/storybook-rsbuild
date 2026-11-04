declare const enabled: boolean

if (enabled) {
  // eslint-disable-next-line no-var -- the hoisted var is the fixture's subject
  var Button = (props: { label: string }) => <button>{props.label}</button>
}

export const components = { Button }
