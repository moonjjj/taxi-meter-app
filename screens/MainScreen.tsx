import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, SafeAreaView, View, Text, StyleSheet, TouchableOpacity,
  Alert, Linking, Modal, TouchableWithoutFeedback, Dimensions,
} from 'react-native';

type Rect = { x: number; y: number; w: number; h: number };
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

// 합성 속도 테스트 모드: null = 실제 GPS 사용, 숫자 = 고정 속도(km/h)
// 예) 6으로 설정하면 GPS 없이 6 km/h 고정으로 동작 확인 가능
const DEBUG_FIXED_SPEED_KMH: number | null = null;

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

const BlinkingLed: React.FC<{ color: string }> = ({ color }) => {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.08, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        shadowColor: color,
        shadowOpacity: 0.95,
        shadowRadius: 5,
        opacity,
        marginRight: 7,
        flexShrink: 0,
      }}
    />
  );
};

const MainScreen: React.FC = () => {
  const timer = useTimer();
  const animator = useFareDisplayAnimator({ initialDisplayFare: BASE_FARE });
  const isRunning = timer.state === 'running';

  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  // gpsLost가 일시적으로 true가 돼도 배너가 깜빡이지 않도록 3초 debounce
  const [showGpsLostBanner, setShowGpsLostBanner] = useState(false);

  const gps = useGpsSpeed(isRunning);

  // gpsLost 3초 debounce: 짧은 신호 끊김엔 배너 표시 안 함
  useEffect(() => {
    if (!gps.gpsLost) {
      setShowGpsLostBanner(false);
      return;
    }
    const t = setTimeout(() => setShowGpsLostBanner(true), 3000);
    return () => clearTimeout(t);
  }, [gps.gpsLost]);

  const onFareIncrement = useCallback(
    (deltaSteps: number) => animator.enqueueFareIncrement(deltaSteps),
    [animator.enqueueFareIncrement]
  );

  // START 전에는 속도 0 고정, 동작 중에는 GPS 값만 사용.
  // GPS 신호 손실(gpsLost) 시에도 0으로 고정 → useCountdownBucket이 시간 기반 모드로 전환.
  // DEBUG_FIXED_SPEED_KMH가 설정된 경우 GPS 대신 고정 속도 사용 (테스트 전용)
  const speedKmh = useMemo(() => {
    if (!isRunning) return 0;
    if (DEBUG_FIXED_SPEED_KMH !== null) return DEBUG_FIXED_SPEED_KMH;
    if (gps.permissionStatus !== 'granted' || gps.error != null || gps.gpsLost) {
      return 0;
    }
    return gps.speedKmh;
  }, [isRunning, gps.permissionStatus, gps.speedKmh, gps.error, gps.gpsLost]);

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

  // [FIX] GPS delta와 updateId를 함께 전달해 실제 GPS 거리를 누적에 반영한다.
  const totalDistanceM = useAccumulatedDistance({
    speedKmh,
    elapsedSeconds: timer.elapsedSeconds,
    deltaDistanceMFromGps: gps.deltaDistanceMFromGps,
    gpsUpdateId: gps.gpsUpdateId,
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

  // 온보딩 툴팁: 앱 시작 시마다 표시, 탭하면 닫힘
  const [showTooltips, setShowTooltips] = useState(true);
  const dismissTooltips = useCallback(() => setShowTooltips(false), []);

  // 버튼 가시성
  const showStartBtn = timer.state === 'idle' || timer.state === 'paused';
  const showPauseBtn = timer.state === 'running';
  const showResetBtn = timer.state === 'running' || timer.state === 'paused';

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

            {/* GPS 신호 손실 배너 (주행 중 신호 끊김, 3초 debounce) */}
            {showGpsLostBanner && isRunning && (
              <View style={[styles.statusPanel, styles.statusPanelAmber]}>
                <BlinkingLed color="#D4A84B" />
                <Text style={styles.statusPanelTextAmber} numberOfLines={1}>
                  !! GPS NO SIGNAL — TIME MODE ACTIVE
                </Text>
              </View>
            )}

            {/* 권한/오류 안내 */}
            {!gps.gpsLost && (gps.error || gps.permissionStatus === 'denied') && (
              <View style={[styles.statusPanel, styles.statusPanelRed]}>
                <BlinkingLed color="#FF5050" />
                <Text style={[styles.statusPanelTextRed, { flex: 1 }]} numberOfLines={2}>
                  {gps.error
                    ? `ERR: ${gps.error}`
                    : 'GPS DENIED — ENABLE IN SETTINGS'}
                </Text>
                <TouchableOpacity
                  style={styles.gpsPermissionButton}
                  onPress={() => {
                    if (gps.permissionStatus === 'denied') {
                      Linking.openSettings();
                    } else {
                      gps.requestPermission();
                    }
                  }}
                >
                  <Text style={styles.gpsPermissionButtonText}>
                    {gps.permissionStatus === 'denied' ? 'SETTINGS' : 'ALLOW'}
                  </Text>
                </TouchableOpacity>
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

        {/* 컨트롤 버튼 영역 — iPhone 통화 UI 스타일 */}
        <View style={styles.controlsWrapper}>
          <View style={styles.controls}>
            {showStartBtn && (
              <View style={styles.callBtnWrap}>
                <TouchableOpacity
                  style={[styles.callBtnCircle, styles.callBtnStart]}
                  onPress={handleStart}
                  activeOpacity={0.7}
                >
                  <Text style={styles.callBtnIcon}>▶</Text>
                </TouchableOpacity>
                <Text style={styles.callBtnLabel}>
                  {timer.state === 'paused' ? 'RESUME' : 'START'}
                </Text>
              </View>
            )}
            {showPauseBtn && (
              <View style={styles.callBtnWrap}>
                <TouchableOpacity
                  style={[styles.callBtnCircle, styles.callBtnPause]}
                  onPress={handlePause}
                  activeOpacity={0.7}
                >
                  <Text style={styles.callBtnIcon}>⏸</Text>
                </TouchableOpacity>
                <Text style={styles.callBtnLabel}>PAUSE</Text>
              </View>
            )}
            {showResetBtn && (
              <View style={styles.callBtnWrap}>
                <TouchableOpacity
                  style={[styles.callBtnCircle, styles.callBtnReset]}
                  onPress={handleReset}
                  activeOpacity={0.7}
                >
                  <Text style={styles.callBtnIcon}>↺</Text>
                </TouchableOpacity>
                <Text style={styles.callBtnLabel}>RESET</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* 온보딩 툴팁 오버레이 */}
      <Modal visible={showTooltips} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={dismissTooltips}>
          <View style={styles.tooltipOverlay}>
            {/* 방향 전환 버튼 툴팁 (우상단) */}
            <View style={[styles.tooltipBubble, { top: 108, right: 12 }]}>
              <View style={[styles.tooltipCaret, styles.tooltipCaretUp]} />
              <Text style={styles.tooltipText}>화면을 가로로{'\n'}전환할 수 있어요</Text>
            </View>

            {/* START 버튼 툴팁 (우하단) */}
            <View style={[styles.tooltipBubble, { bottom: 148, right: 12 }]}>
              <Text style={styles.tooltipText}>눌러서 운행을{'\n'}시작하세요 ▶</Text>
              <View style={[styles.tooltipCaret, styles.tooltipCaretDown, { left: undefined, right: 18 }]} />
            </View>

            <Text style={styles.tooltipDismiss}>화면을 탭하면 닫혀요</Text>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
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
  statusPanel: {
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#030711',
    borderWidth: 1,
    borderRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusPanelAmber: {
    borderColor: '#5C4200',
    borderLeftWidth: 3,
    borderLeftColor: '#D4A84B',
  },
  statusPanelRed: {
    borderColor: '#5A1515',
    borderLeftWidth: 3,
    borderLeftColor: '#FF5050',
  },
  statusPanelTextAmber: {
    color: '#D4A84B',
    fontSize: 8,
    letterSpacing: 1.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  statusPanelTextRed: {
    color: '#FF7070',
    fontSize: 8,
    letterSpacing: 1.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  footerRow: {
    marginTop: 10,
  },
  footerText: {
    color: '#C9BA86',
    fontSize: 8,
  },
  controlsWrapper: {
    marginTop: 14,
    paddingHorizontal: 8,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    gap: 20,
  },
  callBtnWrap: {
    alignItems: 'center',
    gap: 5,
  },
  callBtnCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  callBtnStart: {
    backgroundColor: '#162B18',
    borderColor: '#4CAF50',
  },
  callBtnPause: {
    backgroundColor: '#2D2000',
    borderColor: '#D4A659',
  },
  callBtnReset: {
    backgroundColor: '#2D0C0C',
    borderColor: '#CC3344',
  },
  callBtnIcon: {
    fontSize: 26,
    color: '#EDE2C4',
    includeFontPadding: false,
  },
  callBtnLabel: {
    color: '#B8A77B',
    fontSize: 9,
    letterSpacing: 2,
  },
  // 툴팁
  tooltipOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  tooltipBubble: {
    position: 'absolute',
    backgroundColor: 'rgba(26, 20, 12, 0.97)',
    borderRadius: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(210,180,110,0.18)',
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    paddingHorizontal: 18,
    paddingVertical: 13,
    width: 182,
    shadowColor: '#000',
    shadowOpacity: 0.75,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  tooltipText: {
    color: '#E8D9B8',
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  tooltipCaret: {
    position: 'absolute',
    width: 11,
    height: 11,
    backgroundColor: 'rgba(26, 20, 12, 0.97)',
    transform: [{ rotate: '45deg' }],
  },
  tooltipCaretUp: {
    top: -5.5,
    right: 18,
  },
  tooltipCaretDown: {
    bottom: -5.5,
    left: 85,
  },
  tooltipDismiss: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#C8A96E',
    fontSize: 12,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
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
  gpsPermissionButton: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#FF5050',
    backgroundColor: '#1A0808',
    flexShrink: 0,
  },
  gpsPermissionButtonText: {
    color: '#FF7070',
    fontSize: 7,
    letterSpacing: 1.2,
  },
});

export default MainScreen;

