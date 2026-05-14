import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, SafeAreaView, View, Text, StyleSheet, TouchableOpacity,
  Alert, Linking, Modal, TouchableWithoutFeedback, Pressable, Dimensions, useWindowDimensions,
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
  const { width: winW, height: winH } = useWindowDimensions();
  const isPortrait = winH > winW;
  // 세로모드 말 크기: 화면 높이의 30% vs 전체 너비 중 작은 값 → 작은 기기에서 자동 축소
  const horsePortraitSize = isPortrait ? Math.min(winW - 28, winH * 0.30) : 150;
  // gpsLost가 일시적으로 true가 돼도 배너가 깜빡이지 않도록 3초 debounce
  const [showGpsLostBanner, setShowGpsLostBanner] = useState(false);

  const gps = useGpsSpeed(isRunning);

  // gpsStatus 'lost' 3초 debounce: 짧은 신호 끊김엔 배너 표시 안 함
  useEffect(() => {
    if (gps.gpsStatus !== 'lost') {
      setShowGpsLostBanner(false);
      return;
    }
    const t = setTimeout(() => setShowGpsLostBanner(true), 3000);
    return () => clearTimeout(t);
  }, [gps.gpsStatus]);

  const onFareIncrement = useCallback(
    (deltaSteps: number) => animator.enqueueFareIncrement(deltaSteps),
    [animator.enqueueFareIncrement]
  );

  // START 전에는 속도 0 고정, 동작 중에는 GPS 값만 사용.
  // GPS 신호 완전 손실(gpsStatus='lost') 시에만 0으로 고정 → 시간 기반 모드로 전환.
  // dead reckoning('reckoning') 중에는 훅이 반환하는 frozenSpeed를 그대로 사용 → 거리 기반 유지.
  // DEBUG_FIXED_SPEED_KMH가 설정된 경우 GPS 대신 고정 속도 사용 (테스트 전용)
  const speedKmh = useMemo(() => {
    if (!isRunning) return 0;
    if (DEBUG_FIXED_SPEED_KMH !== null) return DEBUG_FIXED_SPEED_KMH;
    if (gps.permissionStatus !== 'granted' || gps.gpsStatus === 'lost') {
      return 0;
    }
    return gps.speedKmh;
  }, [isRunning, gps.permissionStatus, gps.speedKmh, gps.gpsStatus]);

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
                gps.requestPermission().then(() => {});
              },
            },
          ]
        );
      }
      timer.start();
    }
  }, [timer.state, timer.start, gps.permissionStatus, gps.requestPermission]);

  const handleReset = useCallback(() => {
    timer.reset();
    animator.reset(BASE_FARE);
  }, [timer, animator]);

  // 운행 중 화면 터치 시 띄우는 액션 모달
  const [actionModalVisible, setActionModalVisible] = useState(false);

  // 종료 버튼 길게 누르기 애니메이션
  const holdProgress = useRef(new Animated.Value(0)).current;
  const holdAnim = useRef<Animated.CompositeAnimation | null>(null);

  const onEndHoldIn = useCallback(() => {
    holdProgress.setValue(0);
    holdAnim.current = Animated.timing(holdProgress, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: false,
    });
    holdAnim.current.start(({ finished }) => {
      if (finished) {
        setActionModalVisible(false);
        handleReset();
      }
    });
  }, [holdProgress, handleReset]);

  const onEndHoldOut = useCallback(() => {
    holdAnim.current?.stop();
    Animated.timing(holdProgress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [holdProgress]);

  const handleScreenTouch = useCallback(() => {
    if (timer.state === 'idle') {
      handleStart();
    } else {
      setActionModalVisible(true);
    }
  }, [timer.state, handleStart]);

  const handleModalPause = useCallback(() => {
    setActionModalVisible(false);
    if (timer.state === 'running') timer.pause();
  }, [timer]);

  const handleModalContinue = useCallback(() => {
    setActionModalVisible(false);
    if (timer.state === 'paused') timer.resume();
  }, [timer]);

  // 온보딩 툴팁: 앱 시작 시마다 표시, 탭하면 닫힘
  const [showTooltips, setShowTooltips] = useState(true);
  const dismissTooltips = useCallback(() => setShowTooltips(false), []);

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
      <TouchableWithoutFeedback onPress={handleScreenTouch}>
      <View style={styles.container}>
        {/* 택시 미터기 본체 — flex:1로 전체 채움 */}
        <View style={styles.meterFrameOuter}>
          <View style={[styles.meterFrameInner, isPortrait && styles.meterFrameInnerPortrait]}>
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

            {/* 말 + 요금: 세로모드 column, 가로모드 row */}
            <View style={[styles.fareRow, isPortrait && styles.fareRowPortrait]}>
              <View style={[
                styles.horseColumn,
                isPortrait
                  ? [styles.horseColumnPortrait, { width: horsePortraitSize, height: horsePortraitSize }]
                  : styles.horseColumnLandscape,
              ]}>
                <View style={styles.horseSlot}>
                  <HorseSprite level={horseLevel} />
                </View>
              </View>
              <View style={[styles.fareHighlight, isPortrait && styles.fareHighlightPortrait]}>
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

            {/* 보조: SPEED / DIST / TIME — 세로모드 column, 가로모드 row */}
            <View style={[styles.digitsPanel, isPortrait && styles.digitsPanelPortrait]}>
              <View style={[styles.digitBlock, isPortrait && styles.digitBlockPortrait]}>
                <Text style={styles.digitLabel}>SPEED</Text>
                <View style={isPortrait ? styles.digitValueGroup : undefined}>
                  <SevenSegmentText size="sm">
                    {speedKmh.toFixed(1).padStart(5, '0')}
                  </SevenSegmentText>
                  <Text style={styles.digitUnit}>km/h</Text>
                </View>
              </View>
              <View style={[styles.digitBlock, isPortrait && styles.digitBlockPortrait]}>
                <Text style={styles.digitLabel}>DIST</Text>
                <View style={isPortrait ? styles.digitValueGroup : undefined}>
                  <SevenSegmentText size="sm">
                    {distanceKm.toFixed(2).padStart(5, '0')}
                  </SevenSegmentText>
                  <Text style={styles.digitUnit}>km</Text>
                </View>
              </View>
              <View style={[styles.digitBlock, isPortrait && styles.digitBlockPortrait]}>
                <Text style={styles.digitLabel}>TIME</Text>
                <View style={isPortrait ? styles.digitValueGroup : undefined}>
                  <SevenSegmentText size="sm">
                    {padTime(timer.elapsedSeconds)}
                  </SevenSegmentText>
                </View>
              </View>
            </View>

            {/* GPS dead reckoning 배너 (마지막 속도로 추정 중) */}
            {isRunning && gps.gpsStatus === 'reckoning' && (
              <View style={[styles.statusPanel, styles.statusPanelAmber]}>
                <BlinkingLed color="#E89A30" />
                <Text style={styles.statusPanelTextAmber} numberOfLines={1}>
                  GPS 추정 중 — DEAD RECKONING ACTIVE
                </Text>
              </View>
            )}

            {/* GPS 신호 완전 손실 배너 (3초 debounce) */}
            {showGpsLostBanner && isRunning && gps.gpsStatus === 'lost' && (
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

      </View>
      </TouchableWithoutFeedback>

      {/* 운행 중 터치 시 액션 모달 */}
      <Modal
        visible={actionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setActionModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => {
          onEndHoldOut();
          setActionModalVisible(false);
        }}>
          <View style={styles.actionModalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.actionModalCard}>
                <Text style={styles.actionModalTitle}>운행을 마치시겠습니까?</Text>

                {/* 종료 — 길게 눌러야 실행 */}
                <Pressable
                  onPressIn={onEndHoldIn}
                  onPressOut={onEndHoldOut}
                  style={styles.actionModalBtnEnd}
                >
                  <View style={styles.actionModalBtnEndInner}>
                    <Animated.View
                      style={[
                        styles.actionModalBtnEndFill,
                        { width: holdProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                      ]}
                    />
                    <Text style={styles.actionModalBtnEndText}>종료</Text>
                    <Text style={styles.actionModalBtnEndHint}>길게 누르세요</Text>
                  </View>
                </Pressable>

                {/* 일시정지 */}
                <TouchableOpacity
                  style={[
                    styles.actionModalBtnPause,
                    timer.state === 'paused' && styles.actionModalBtnDisabled,
                  ]}
                  onPress={handleModalPause}
                  activeOpacity={0.75}
                  disabled={timer.state === 'paused'}
                >
                  <Text style={styles.actionModalBtnPauseText}>
                    {timer.state === 'paused' ? '일시정지 중' : '일시정지'}
                  </Text>
                </TouchableOpacity>

                {/* 계속진행 — primary */}
                <TouchableOpacity
                  style={styles.actionModalBtnContinue}
                  onPress={handleModalContinue}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionModalBtnContinueText}>
                    {timer.state === 'paused' ? '운행 재개' : '계속진행'}
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* 온보딩 툴팁 오버레이 */}
      <Modal visible={showTooltips} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={dismissTooltips}>
          <View style={styles.tooltipOverlay}>
            {/* 방향 전환 버튼 툴팁 (우상단) */}
            <View style={[styles.tooltipBubble, { top: 108, right: 12 }]}>
              <View style={[styles.tooltipCaret, styles.tooltipCaretUp]} />
              <Text style={styles.tooltipText}>화면을 가로로{'\n'}전환할 수 있어요</Text>
            </View>

            {/* 화면 터치 안내 (하단 중앙) */}
            <View style={[styles.tooltipBubble, { bottom: 100, alignSelf: 'center', right: undefined }]}>
              <Text style={styles.tooltipText}>화면을 터치하면{'\n'}운행이 시작돼요</Text>
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
    position: 'relative',
  },
  container: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 16,
    backgroundColor: '#050608',
  },
  meterFrameOuter: {
    flex: 1,
    borderRadius: 10,
    padding: 6,
    backgroundColor: '#D1C39A',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  meterFrameInner: {
    flex: 1,
    width: '100%',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#02040A',
    borderWidth: 1,
    borderColor: '#4B4844',
    justifyContent: 'space-between',
  },
  meterFrameInnerPortrait: {
    justifyContent: 'flex-start',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandLeft: {
    color: '#EEDCB0',
    fontSize: 15,
    letterSpacing: 1.5,
  },
  brandCenterTitle: {
    color: '#EEDCB0',
    fontSize: 17,
    letterSpacing: 2,
  },
  brandRight: {
    color: '#EEDCB0',
    fontSize: 17,
    letterSpacing: 2,
  },
  fareRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  fareRowPortrait: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  fareHighlight: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#030711',
    borderWidth: 1,
    borderColor: '#1C2732',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  fareHighlightPortrait: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  fareLabel: {
    color: '#B8A77B',
    fontSize: 15,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  fareValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  fareUnit: {
    color: '#EEDCB0',
    fontSize: 21,
    marginLeft: 2,
  },
  horseColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  horseColumnLandscape: {
    width: 150,
    height: 150,
    marginRight: 6,
  },
  horseColumnPortrait: {
    marginBottom: 10,
    alignSelf: 'center',
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
  digitsPanelPortrait: {
    flexDirection: 'column',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6,
  },
  digitBlockPortrait: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 0,
    marginHorizontal: 0,
    paddingVertical: 6,
  },
  digitValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  digitBlock: {
    flex: 1,
    marginHorizontal: 2,
    alignItems: 'center',
  },
  digitLabel: {
    color: '#B8A77B',
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  digitUnit: {
    marginTop: 0,
    color: '#B8A77B',
    fontSize: 9,
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
    fontSize: 12,
    letterSpacing: 1.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  statusPanelTextRed: {
    color: '#FF7070',
    fontSize: 12,
    letterSpacing: 1.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  footerRow: {
    marginTop: 10,
  },
  footerText: {
    color: '#C9BA86',
    fontSize: 12,
  },
  controlsWrapper: {
    position: 'absolute',
    bottom: 36,
    right: 20,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    gap: 14,
  },
  callBtnWrap: {
    alignItems: 'center',
    gap: 4,
  },
  callBtnCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.7,
    shadowRadius: 8,
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
    fontSize: 30,
    color: '#EDE2C4',
    includeFontPadding: false,
  },
  callBtnLabel: {
    color: '#B8A77B',
    fontSize: 12,
    letterSpacing: 1.5,
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
    fontSize: 19,
    lineHeight: 28,
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
    fontSize: 18,
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
    fontSize: 12,
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
    fontSize: 14,
    letterSpacing: 1,
  },
  // 액션 모달
  actionModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionModalCard: {
    width: 300,
    backgroundColor: '#0D1018',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2E2A22',
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.85,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    gap: 10,
  },
  actionModalTitle: {
    color: '#EEDCB0',
    fontSize: 17,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: 8,
  },
  // 종료 버튼 (홀드)
  actionModalBtnEnd: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7A2030',
    backgroundColor: '#1A080C',
    overflow: 'hidden',
  },
  actionModalBtnEndInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 8,
  },
  actionModalBtnEndFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#5A1020',
  },
  actionModalBtnEndText: {
    color: '#CC4455',
    fontSize: 14,
    letterSpacing: 0.5,
    zIndex: 1,
  },
  actionModalBtnEndHint: {
    color: '#6B3040',
    fontSize: 11,
    letterSpacing: 0.3,
    zIndex: 1,
  },
  // 일시정지 버튼
  actionModalBtnPause: {
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#6B5020',
    backgroundColor: '#1A1200',
    alignItems: 'center',
  },
  actionModalBtnPauseText: {
    color: '#C49A40',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  // 계속진행 버튼 (primary)
  actionModalBtnContinue: {
    paddingVertical: 18,
    borderRadius: 10,
    backgroundColor: '#162B18',
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    alignItems: 'center',
    marginTop: 4,
    shadowColor: '#4CAF50',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  actionModalBtnContinueText: {
    color: '#7FD982',
    fontSize: 17,
    letterSpacing: 1,
  },
  actionModalBtnDisabled: {
    opacity: 0.35,
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
    fontSize: 11,
    letterSpacing: 1.2,
  },
});

export default MainScreen;

