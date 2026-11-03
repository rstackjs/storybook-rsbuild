interface ProductCardProps {
  /** Card title. */
  title: string
}

/**
 * A product card.
 */
export default function ProductCard({ title }: ProductCardProps) {
  return <div>{title}</div>
}
