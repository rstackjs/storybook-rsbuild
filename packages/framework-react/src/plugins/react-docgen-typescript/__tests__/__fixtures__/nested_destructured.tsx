const bundle = {
  nested: {
    Button: (props: { label: string }) => <button>{props.label}</button>,
    Link: (props: { label: string }) => <a>{props.label}</a>,
  },
}

export const {
  nested: { Button },
} = bundle

const {
  nested: { Link },
} = bundle

export const components = { Link }
