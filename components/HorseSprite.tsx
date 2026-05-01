import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';
import type { SpeedLevel } from '../hooks/useSpeedMetrics';

type HorseSpriteProps = {
  level?: SpeedLevel;
};

const SPEED_BY_LEVEL: Record<SpeedLevel, number> = {
  idle: 0,
  low: 0.6,
  mid: 1.2,
  high: 2,
};

export const HorseSprite: React.FC<HorseSpriteProps> = ({ level = 'idle' }) => {
  const lottieRef = useRef<LottieView>(null);
  const speed = SPEED_BY_LEVEL[level];
  const isIdle = level === 'idle';

  useEffect(() => {
    if (isIdle) {
      lottieRef.current?.pause();
    } else {
      lottieRef.current?.play();
    }
  }, [isIdle]);

  return (
    <View style={styles.track}>
      <View style={styles.horseWrapper}>
        <LottieView
          ref={lottieRef}
          source={require('../assets/lottie/horse-lottie.json')}
          style={styles.lottie}
          loop
          speed={speed}
          autoPlay={!isIdle}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    height: '100%',
    minHeight: 72,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#3B4E5A',
    backgroundColor: '#050912',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  horseWrapper: {
    width: '100%',
    height: '100%',
    minHeight: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottie: {
    width: 200,
    height: 100,
  },
});

export default HorseSprite;
