// eslint-disable-next-line @typescript-eslint/no-namespace -- namespace members are the fixture's subject
export namespace Widgets {
  export const Button = (props: { label: string }) => (
    <button>{props.label}</button>
  )
}
