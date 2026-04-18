import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import OdometerNumber from './OdometerNumber';
import type { CountdownMode } from '../hooks/useCountdownBucket';

type CountdownRollingDisplayProps = {
  /** 계산된 값. 변경 시 오도미터 롤링으로 전환 */
  actualValue: number;
  /** 단위 */
  unit: 'm' | 'sec';
  /** 모드 (라벨 등에 활용 가능) */
  mode: CountdownMode;
  size?: 'sm' | 'md' | 'lg';
};

const sizeMap = { sm: 'sm' as const, md: 'md' as const, lg: 'lg' as const };

/**
 * 레트로 택시 미터기 스타일 4자리 카운트다운 표시.
 * actualValue가 바뀔 때 오도미터(자릿수 롤링) 애니메이션으로 전환.
 */
const CountdownRollingDisplay: React.FC<CountdownRollingDisplayProps> = ({
  actualValue,
  unit,
  mode,
  size = 'md',
}) => {
  return (
    <View style={styles.column}>
      <View style={styles.wrapper}>
        <OdometerNumber
          value={actualValue}
          numDigits={4}
          size={sizeMap[size]}
          variant="secondary"
          animate={false}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
  },
  wrapper: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
});

export default CountdownRollingDisplay;
