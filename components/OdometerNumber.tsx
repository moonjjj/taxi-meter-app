import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import {
  SevenDigit,
  sizeMap,
  ON_PRIMARY,
  ON_SECONDARY,
  ON_FARE,
  OFF_SEGMENT,
  OFF_SEGMENT_FARE,
} from './SevenSegmentText';

type OdometerSize = 'sm' | 'md' | 'lg' | 'xl';
type OdometerVariant = 'primary' | 'secondary' | 'fare';

const ROLL_DURATION_MS = 220;
const STAGGER_MS = 50;

function getDigits(value: number, numDigits: number): number[] {
  const s = Math.max(0, Math.floor(value))
    .toString()
    .padStart(numDigits, '0');
  return s.slice(-numDigits).split('').map(Number);
}

type RollingDigitColumnProps = {
  fromDigit: number;
  toDigit: number;
  progress: Animated.Value;
  size: OdometerSize;
  variant: OdometerVariant;
};

const colorMap = {
  primary: ON_PRIMARY,
  secondary: ON_SECONDARY,
  fare: ON_FARE,
};
const offColorMap = {
  primary: OFF_SEGMENT,
  secondary: OFF_SEGMENT,
  fare: OFF_SEGMENT_FARE,
};

const RollingDigitColumn: React.FC<RollingDigitColumnProps> = ({
  fromDigit,
  toDigit,
  progress,
  size,
  variant,
}) => {
  const { width, height, thickness, margin } = sizeMap[size];
  const color = colorMap[variant];
  const offColor = offColorMap[variant];
  const cellHeight = height + 4;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -cellHeight],
  });

  return (
    <View
      style={[
        styles.digitColumn,
        {
          width: width + margin,
          height: cellHeight,
        },
      ]}
    >
      <View style={[styles.clip, { width: width + margin, height: cellHeight }]}>
        <Animated.View
          style={[
            styles.digitStrip,
            {
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.digitCell}>
            <SevenDigit
              ch={String(fromDigit)}
              color={color}
              offColor={offColor}
              width={width}
              height={height}
              thickness={thickness}
            />
          </View>
          <View style={styles.digitCell}>
            <SevenDigit
              ch={String(toDigit)}
              color={color}
              offColor={offColor}
              width={width}
              height={height}
              thickness={thickness}
            />
          </View>
        </Animated.View>
      </View>
    </View>
  );
};

type OdometerNumberProps = {
  value: number;
  numDigits?: number;
  size?: OdometerSize;
  variant?: OdometerVariant;
  /** 기본값 true. false면 애니메이션 없이 값만 즉시 갱신 */
  animate?: boolean;
};

/**
 * 기계식 미터기/오도미터 스타일 숫자 표시.
 * value가 바뀔 때만 자릿수가 굴러 떨어지는 롤링 애니메이션.
 * +100원 시 백원 자리 중심, carry 시 천원 자리 등 연쇄 롤링(stagger).
 */
const OdometerNumber: React.FC<OdometerNumberProps> = ({
  value,
  numDigits = 6,
  size = 'xl',
  variant = 'fare',
  animate = true,
}) => {
  const [displayedValue, setDisplayedValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const progressRef = useRef<Animated.Value[]>(
    Array.from({ length: numDigits }, () => new Animated.Value(0))
  );
  const fromValueRef = useRef(value);

  useEffect(() => {
    const target = Math.max(0, Math.floor(value));
    if (!animate) {
      setDisplayedValue(target);
      fromValueRef.current = target;
      progressRef.current.forEach((p) => p.setValue(0));
      setIsAnimating(false);
      return;
    }
    if (target === displayedValue || isAnimating) return;

    fromValueRef.current = displayedValue;
    setIsAnimating(true);

    const fromDigits = getDigits(displayedValue, numDigits);
    const toDigits = getDigits(target, numDigits);

    const animations = progressRef.current
      .map((prog, i) => {
        if (fromDigits[i] === toDigits[i]) return null;
        prog.setValue(0);
        const delay = (numDigits - 1 - i) * STAGGER_MS;
        return Animated.timing(prog, {
          toValue: 1,
          duration: ROLL_DURATION_MS,
          delay,
          useNativeDriver: true,
        });
      })
      .filter((a): a is Animated.CompositeAnimation => a != null);

    if (animations.length === 0) {
      setDisplayedValue(target);
      fromValueRef.current = target;
      setIsAnimating(false);
      return;
    }

    Animated.parallel(animations).start(() => {
      setDisplayedValue(target);
      fromValueRef.current = target;
      progressRef.current.forEach((p) => p.setValue(0));
      setIsAnimating(false);
    });
  }, [value, displayedValue, numDigits, isAnimating, animate]);

  const fromD = getDigits(
    isAnimating ? fromValueRef.current : displayedValue,
    numDigits
  );
  const toD = getDigits(value, numDigits);

  return (
    <View style={styles.row}>
      {progressRef.current.map((prog, i) => (
        <RollingDigitColumn
          key={i}
          fromDigit={fromD[i] ?? 0}
          toDigit={toD[i] ?? 0}
          progress={prog}
          size={size}
          variant={variant}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  digitColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clip: {
    overflow: 'hidden',
  },
  digitStrip: {
    alignItems: 'center',
  },
  digitCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
});

export default OdometerNumber;
