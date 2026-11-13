import { Badge } from './Badge'

export function Card({ title }: { title: string }) {
  return (
    <section>
      <h2>{title}</h2> <Badge text="Card" />
    </section>
  )
}
