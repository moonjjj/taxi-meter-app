import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import SevenSegmentText from '../components/SevenSegmentText';
import HorseSprite from '../components/HorseSprite';
import CountdownRollingDisplay from '../components/CountdownRollingDisplay';
import OdometerNumber from '../components/OdometerNumber';
import { useTimer } from '../hooks/useTimer';
import { useGpsSpeed } from '../hooks/useGpsSpeed';
import { useAccumulatedDistance } from '../hooks/useAccumulatedDistance';
import { useCountdownBucket } from '../hooks/useCountdownBucket';
import { useFareDisplayAnimator } from '../hooks/useFareDisplayAnimator';

const BASE_FARE = 3000;
const FARE_STEP_MS = 180;

/** 타이머 경과 기반 모의 속도(km/h). 5~70 구간 선회 */
function mockSpeedKmh(elapsedSeconds: number): number {
  const t = elapsedSeconds / 10;
  return 37.5 + 32.5 * Math.sin(t);
}

/** 속도 구간 → HorseSprite level (5~70km/h 기준, 추가 상태는 아래 useMemo에서 보정) */
function speedToLevel(speedKmh: number): 'idle' | 'low' | 'mid' | 'high' {
  if (speedKmh < 5) return 'idle';
  if (speedKmh < 20) return 'low';
  if (speedKmh < 50) return 'mid';
  return 'high';
}

const padTime = (sec: number) => {
  const h = Math.floor(sec / 3600)
    .toString()
    .padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const MainScreen: React.FC = () => {
  const timer = useTimer();
  const animator = useFareDisplayAnimator({ initialDisplayFare: BASE_FARE });
  const isRunning = timer.state === 'running';

  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');

  const gps = useGpsSpeed(isRunning);

  const onFareIncrement = useCallback(
    (deltaSteps: number) => animator.enqueueFareIncrement(deltaSteps),
    [animator.enqueueFareIncrement]
  );

  // START 전에는 속도 0 고정, 동작 중에는 GPS 값만 사용
  const speedKmh = useMemo(() => {
    if (!isRunning) {
      return 0;
    }
    if (gps.permissionStatus !== 'granted' || gps.error != null) {
      return 0;
    }
    return gps.speedKmh;
  }, [isRunning, gps.permissionStatus, gps.speedKmh, gps.error]);

  const horseLevel = useMemo(() => {
    // 아직 한 번도 START 하지 않은 완전 대기 상태에서만 말 정지
    if (timer.state === 'idle') {
      return 'idle' as const;
    }
    // START 이후( running 또는 paused )에는 속도가 거의 0이어도 항상 걷기 이상
    const baseLevel = speedToLevel(speedKmh);
    if (baseLevel === 'idle') {
      return 'low' as const;
    }
    return baseLevel;
  }, [speedKmh, timer.state]);

  const totalDistanceM = useAccumulatedDistance({
    speedKmh,
    elapsedSeconds: timer.elapsedSeconds,
  });
  const distanceKm = totalDistanceM / 1000;

  const countdown = useCountdownBucket({
    totalDistanceM,
    speedKmh,
    elapsedSeconds: timer.elapsedSeconds,
    onFareIncrement,
  });

  // (1) 큐에 step이 있고 애니메이션 중이 아니면 한 step 시작
  useEffect(() => {
    if (animator.pendingStepCount <= 0 || animator.isFareAnimating) return;
    animator.processNextStep();
  }, [
    animator.pendingStepCount,
    animator.isFareAnimating,
    animator.processNextStep,
  ]);

  // (2) 애니메이션 중이면 FARE_STEP_MS 후 완료 처리 (effect 분리로 cleanup이 타임아웃을 취소하지 않음)
  useEffect(() => {
    if (!animator.isFareAnimating) return;
    const t = setTimeout(() => animator.onAnimationComplete(), FARE_STEP_MS);
    return () => clearTimeout(t);
  }, [animator.isFareAnimating, animator.onAnimationComplete]);

  const handleStart = useCallback(() => {
    if (timer.state === 'paused') {
      timer.resume();
      return;
    }
    if (timer.state === 'idle') {
      if (gps.permissionStatus !== 'granted') {
        Alert.alert(
          'gps를 허용해주세요.',
          '실제 속도로 요금을 계산하려면 위치 권한이 필요합니다.',
          [
            { text: '취소', style: 'cancel' },
            {
              text: '허용',
              onPress: () => {
                gps.requestPermission().then((granted) => {
                  // 권한이 허용되면 이후부터는 실제 GPS 속도로 계산
                });
              },
            },
          ]
        );
      }
      timer.start();
    }
  }, [timer.state, timer.start, timer.resume, gps.permissionStatus, gps.requestPermission]);

  const handlePause = useCallback(() => timer.pause(), [timer.pause]);

  const handleReset = useCallback(() => {
    timer.reset();
    animator.reset(BASE_FARE);
  }, [timer, animator]);

  const handleToggleOrientation = useCallback(async () => {
    try {
      if (orientation === 'portrait') {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        setOrientation('landscape');
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        setOrientation('portrait');
      }
    } catch (e) {
      console.warn('Failed to change orientation', e);
    }
  }, [orientation]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* 택시 미터기 본체 */}
        <View style={styles.meterFrameOuter}>
          <View style={styles.meterFrameInner}>
            {/* 상단 브랜드 / 타이틀 */}
            <View style={styles.topRow}>
              <Text style={styles.brandLeft}>TAXI</Text>
              <Text style={styles.brandCenterTitle}>RETRO TAXI</Text>
              <View style={styles.brandRightGroup}>
                <TouchableOpacity
                  style={styles.orientationTinyButton}
                  onPress={handleToggleOrientation}
                >
                  <Text style={styles.orientationTinyButtonText}>
                    {orientation === 'portrait' ? '가로' : '세로'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 왼쪽: 말(정사각형) / 오른쪽: 요금(안에 Base 포함) */}
            <View style={styles.fareRow}>
              <View style={styles.horseColumn}>
                <View style={styles.horseSlot}>
                  <HorseSprite level={horseLevel} />
                </View>
              </View>
              <View style={styles.fareHighlight}>
                <Text style={styles.fareLabel}>요금</Text>
                <View style={styles.fareValueRow}>
                  <OdometerNumber
                    value={animator.displayFare}
                    numDigits={6}
                    size="xl"
                    variant="fare"
                  />
                  <Text style={styles.fareUnit}>원</Text>
                </View>
                <View style={styles.baseSlot}>
                  <CountdownRollingDisplay
                    actualValue={countdown.actualValue}
                    unit={countdown.unit}
                    mode={countdown.mode}
                    size="sm"
                  />
                </View>
              </View>
            </View>

            {/* 보조: SPEED / DIST / TIME (작게) */}
            <View style={styles.digitsPanel}>
              <View style={styles.digitBlock}>
                <Text style={styles.digitLabel}>SPEED</Text>
                <SevenSegmentText size="sm">
                  {speedKmh.toFixed(1).padStart(5, '0')}
                </SevenSegmentText>
                <Text style={styles.digitUnit}>km/h</Text>
              </View>
              <View style={styles.digitBlock}>
                <Text style={styles.digitLabel}>DIST</Text>
                <SevenSegmentText size="sm">
                  {distanceKm.toFixed(2).padStart(5, '0')}
                </SevenSegmentText>
                <Text style={styles.digitUnit}>km</Text>
              </View>
              <View style={styles.digitBlock}>
                <Text style={styles.digitLabel}>TIME</Text>
                <SevenSegmentText size="sm">
                  {padTime(timer.elapsedSeconds)}
                </SevenSegmentText>
              </View>
            </View>

            {/* 권한/오류 안내 */}
            {(gps.error || gps.permissionStatus === 'denied') && (
              <View style={styles.permissionRow}>
                <Text style={styles.permissionText} numberOfLines={2}>
                  {gps.error ?? '위치 권한이 거부되었습니다. 설정에서 허용하면 실제 속도로 요금이 적용됩니다.'}
                </Text>
              </View>
            )}

            {/* 하단 보조 텍스트 */}
            <View style={styles.footerRow}>
              <Text style={styles.footerText}>
                RETRO TAXI MADE BY JESEON
              </Text>
            </View>
          </View>
        </View>

        {/* 컨트롤 버튼 영역 */}
        <View style={styles.controlsWrapper}>
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.controlButton, styles.startButton]}
              onPress={handleStart}
            >
              <Text style={styles.controlButtonText}>START</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButton, styles.pauseButton]}
              onPress={handlePause}
            >
              <Text style={styles.controlButtonText}>PAUSE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButton, styles.resetButton]}
              onPress={handleReset}
            >
              <Text style={styles.controlButtonText}>RESET</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050608',
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 28,
    backgroundColor: '#050608',
    justifyContent: 'space-between',
  },
  meterFrameOuter: {
    borderRadius: 10,
    padding: 6,
    backgroundColor: '#D1C39A',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  meterFrameInner: {
    width: '100%',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#02040A',
    borderWidth: 1,
    borderColor: '#4B4844',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandLeft: {
    color: '#EEDCB0',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  brandCenterTitle: {
    color: '#EEDCB0',
    fontSize: 11,
    letterSpacing: 2,
  },
  brandRight: {
    color: '#EEDCB0',
    fontSize: 11,
    letterSpacing: 2,
  },
  fareRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 100,
  },
  fareHighlight: {
    flex: 1,
    height: 100,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#030711',
    borderWidth: 1,
    borderColor: '#1C2732',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  fareLabel: {
    color: '#B8A77B',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  fareValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  fareUnit: {
    color: '#EEDCB0',
    fontSize: 14,
    marginLeft: 2,
  },
  horseColumn: {
    width: 100,
    height: 100,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  horseSlot: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  baseSlot: {
    marginTop: 4,
    paddingVertical: 1,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  digitsPanel: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: '#030711',
    borderWidth: 1,
    borderColor: '#1C2732',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  digitBlock: {
    flex: 1,
    marginHorizontal: 2,
    alignItems: 'center',
  },
  digitLabel: {
    color: '#B8A77B',
    fontSize: 7,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  digitUnit: {
    marginTop: 0,
    color: '#B8A77B',
    fontSize: 6,
  },
  permissionRow: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(180, 80, 60, 0.2)',
    borderRadius: 4,
  },
  permissionText: {
    color: '#E8A090',
    fontSize: 9,
  },
  footerRow: {
    marginTop: 10,
  },
  footerText: {
    color: '#C9BA86',
    fontSize: 8,
  },
  controlsWrapper: {
    marginTop: 10,
    paddingHorizontal: 8,
  },
  controls: {
    flexDirection: 'row',
  },
  controlButton: {
    flex: 1,
    marginHorizontal: 3,
    paddingVertical: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#6A5B47',
    backgroundColor: '#1B1814',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  startButton: {
    backgroundColor: '#283F2A',
    borderColor: '#6FBF6A',
  },
  pauseButton: {
    backgroundColor: '#3A3020',
    borderColor: '#D4A659',
  },
  resetButton: {
    backgroundColor: '#262123',
    borderColor: '#B06E78',
  },
  controlButtonText: {
    color: '#EDE2C4',
    fontSize: 10,
    letterSpacing: 2,
  },
  brandRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  orientationTinyButton: {
    marginLeft: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#6A5B47',
    backgroundColor: '#1B1814',
  },
  orientationTinyButtonText: {
    color: '#EDE2C4',
    fontSize: 8,
    letterSpacing: 1,
  },
  orientationRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  orientationButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4B4844',
    backgroundColor: '#14151A',
  },
  orientationButtonText: {
    color: '#EDE2C4',
    fontSize: 9,
    letterSpacing: 1,
  },
});

export default MainScreen;

