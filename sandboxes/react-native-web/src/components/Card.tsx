import type { ReactNode } from 'react'
import {
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'

export interface CardProps {
  /** The title of the card */
  title?: string
  /** The content of the card */
  children?: ReactNode
  /** Additional styles for the card container */
  style?: StyleProp<ViewStyle>
  /** Whether to show a shadow */
  elevated?: boolean
}

/**
 * A card component for displaying content in a contained area.
 * Built with React Native primitives.
 */
export function Card({ title, children, style, elevated = false }: CardProps) {
  return (
    <View style={[styles.card, elevated && styles.elevated, style]}>
      {title && <Text style={styles.title}>{title}</Text>}
      <View style={styles.content}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    // elevation is Android-specific but works in RNW
    elevation: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  content: {
    // Content container styles
  },
})
