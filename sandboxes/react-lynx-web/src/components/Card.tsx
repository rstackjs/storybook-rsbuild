import './Card.css'

export function Card({
  title = 'Hello',
  body = 'This is a card',
}: {
  title?: string
  body?: string
}) {
  return (
    <page>
      <view className="Card">
        <text className="Card__title">{title}</text>
        <text className="Card__body">{body}</text>
      </view>
    </page>
  )
}
