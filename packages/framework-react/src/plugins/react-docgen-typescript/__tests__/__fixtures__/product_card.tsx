import * as React from 'react'

interface ProductCardProps {
  /** Card title. */
  title: string
  highlighted?: boolean
}

/**
 * A product card.
 */
const ProductCard: React.FC<ProductCardProps> = ({ title, highlighted }) => (
  <div>{highlighted ? `* ${title}` : title}</div>
)

export default ProductCard
