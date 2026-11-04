import * as React from 'react'

interface CardProps {
  /** Card title. */
  title: string
}

/**
 * A card.
 */
export class Card extends React.Component<CardProps> {
  static Header = ({ label }: { label: string }) => <header>{label}</header>

  render() {
    return <div>{this.props.title}</div>
  }
}
