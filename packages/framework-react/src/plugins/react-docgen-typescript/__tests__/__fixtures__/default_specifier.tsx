import * as React from 'react'

interface ProductCardProps {
  /** Card title. */
  title: string
}

/**
 * A product card.
 */
const ProductCard: React.FC<ProductCardProps> = ({ title }) => (
  <div>{title}</div>
)

export { ProductCard as default }
