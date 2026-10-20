import { View, StyleSheet } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

export interface CostRow {
  /** Label for the cost line (e.g. "Session fee"). */
  label: string;
  /** Formatted amount string (e.g. "45.00 EUR"). */
  amount: string;
}

export interface CostBreakdownProps extends ViewProps {
  /** Array of three cost rows. The last row is visually emphasised. */
  rows: readonly [CostRow, CostRow, CostRow];
}

/**
 * Cost breakdown display with three rows, the last one emphasised.
 * Uses tabular-nums fontVariant for aligned numbers.
 */
export function CostBreakdown({ rows, style, ...rest }: CostBreakdownProps) {
  const { space } = useTheme();

  return (
    <View style={[{ gap: space[8] }, style]} {...rest}>
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        return (
          <View key={row.label} style={styles.row}>
            <Text
              role={isLast ? 'label' : 'body'}
              tone={isLast ? 'default' : 'secondary'}
            >
              {row.label}
            </Text>
            <Text
              role={isLast ? 'label' : 'body'}
              tone="default"
              style={{
                fontVariant: ['tabular-nums'],
              }}
            >
              {row.amount}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
