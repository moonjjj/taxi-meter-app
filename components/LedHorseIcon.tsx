import React from 'react';
import { View, StyleSheet } from 'react-native';

const LedHorseIcon: React.FC = () => {
  return (
    <View style={styles.wrapper}>
      {/* 몸통 */}
      <View style={styles.body} />
      {/* 목 */}
      <View style={styles.neck} />
      {/* 머리 */}
      <View style={styles.head} />
      {/* 앞다리 */}
      <View style={styles.frontLeg} />
      {/* 뒷다리 */}
      <View style={styles.backLeg} />
      {/* 꼬리 */}
      <View style={styles.tail} />
    </View>
  );
};

const SEG_COLOR = '#6FF7FF';

const styles = StyleSheet.create({
  wrapper: {
    width: 64,
    height: 20,
  },
  body: {
    position: 'absolute',
    left: 6,
    top: 8,
    width: 34,
    height: 3,
    backgroundColor: SEG_COLOR,
    borderRadius: 2,
  },
  neck: {
    position: 'absolute',
    left: 34,
    top: 3,
    width: 3,
    height: 9,
    backgroundColor: SEG_COLOR,
    borderRadius: 2,
  },
  head: {
    position: 'absolute',
    left: 36,
    top: 2,
    width: 10,
    height: 3,
    backgroundColor: SEG_COLOR,
    borderRadius: 2,
  },
  frontLeg: {
    position: 'absolute',
    left: 30,
    top: 10,
    width: 3,
    height: 8,
    backgroundColor: SEG_COLOR,
    borderRadius: 2,
  },
  backLeg: {
    position: 'absolute',
    left: 12,
    top: 10,
    width: 3,
    height: 8,
    backgroundColor: SEG_COLOR,
    borderRadius: 2,
  },
  tail: {
    position: 'absolute',
    left: 4,
    top: 6,
    width: 6,
    height: 3,
    backgroundColor: SEG_COLOR,
    borderRadius: 2,
  },
});

export default LedHorseIcon;

