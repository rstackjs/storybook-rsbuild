const bundle = {
  Button: (props: { label: string }) => <button>{props.label}</button>,
  Link: (props: { label: string }) => <a>{props.label}</a>,
}

export const { Button, Link: LinkAlias } = bundle
