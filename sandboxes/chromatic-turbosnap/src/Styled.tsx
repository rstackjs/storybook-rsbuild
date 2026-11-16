import './plain.css'
import styles from './Styled.module.css'

export function Styled({ text }: { text: string }) {
  return <p className={`plain ${styles.box}`}>{text}</p>
}
