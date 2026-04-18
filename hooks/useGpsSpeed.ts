import { useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';

/** 두 위경도 사이 거리(m). Haversine 근사 */
function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type GpsSpeedResult = {
  /** 현재 속도 (km/h). 측정 불가/정지 시 0 */
  speedKmh: number;
  /** 이번 GPS 업데이트에서 이동한 거리(m). 위치 갱신이 없으면 undefined, 이상값 필터링 시 null */
  deltaDistanceMFromGps: number | null | undefined;
  /** deltaDistanceMFromGps가 갱신될 때마다 증가하는 단조 카운터 (소비 여부 추적용) */
  gpsUpdateId: number;
  /** 주행 중 GPS 신호가 끊긴 상태 (5초 이상 업데이트 없음) */
  gpsLost: boolean;
  /** 권한 상태 */
  permissionStatus: 'undetermined' | 'granted' | 'denied';
  /** 권한 요청 중 */
  isRequestingPermission: boolean;
  /** 오류 메시지 (권한 거부, 위치 오류 등) */
  error: string | null;
  /** 권한 요청 (START 전 또는 권한 없을 때 호출) */
  requestPermission: () => Promise<boolean>;
};

const LOCATION_WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1500,
  distanceInterval: 0,
};

const MAX_SPEED_KMH = 120;
const MIN_DT_MS = 200;
const MAX_ACCEPTABLE_ACCURACY_M = 50;
const SMOOTHING_ALPHA = 0.3;
const MAX_JUMP_PER_UPDATE_KMH = 12;
/** 이 시간(ms) 동안 GPS 업데이트가 없으면 신호 손실로 판단 */
const GPS_SIGNAL_TIMEOUT_MS = 5000;

export function useGpsSpeed(isRunning: boolean): GpsSpeedResult {
  const [speedKmh, setSpeedKmh] = useState(0);
  const [deltaDistanceMFromGps, setDeltaDistanceMFromGps] = useState<
    number | null | undefined
  >(undefined);
  const [gpsUpdateId, setGpsUpdateId] = useState(0);
  const [gpsLost, setGpsLost] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<
    'undetermined' | 'granted' | 'denied'
  >('undetermined');
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastLocationRef = useRef<Location.LocationObject | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastSmoothedSpeedRef = useRef<number | null>(null);
  const gpsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    setIsRequestingPermission(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status === 'granted' ? 'granted' : 'denied');
      if (status !== 'granted') {
        setError('위치 권한이 필요합니다. 설정에서 허용해 주세요.');
        return false;
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '위치 권한 요청 실패';
      setError(msg);
      setPermissionStatus('denied');
      return false;
    } finally {
      setIsRequestingPermission(false);
    }
  }, []);

  // 권한 확인 (앱 로드 시 한 번) — undetermined이면 즉시 시스템 팝업 요청
  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (cancelled) return;
      if (status === 'undetermined') {
        requestPermission();
      } else {
        setPermissionStatus(status === 'granted' ? 'granted' : 'denied');
      }
    });
    return () => { cancelled = true; };
  }, [requestPermission]);

  // isRunning일 때만 위치 감시
  useEffect(() => {
    if (!isRunning) {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      if (gpsTimeoutRef.current) {
        clearTimeout(gpsTimeoutRef.current);
        gpsTimeoutRef.current = null;
      }
      lastLocationRef.current = null;
      lastSmoothedSpeedRef.current = null; // [FIX] 재시작 시 이전 스무딩 값 초기화
      setSpeedKmh(0);
      setDeltaDistanceMFromGps(undefined);
      setGpsLost(false);
      return;
    }

    if (permissionStatus !== 'granted') {
      setSpeedKmh(0);
      setDeltaDistanceMFromGps(undefined);
      return;
    }

    setError(null);
    setGpsLost(false);

    /**
     * GPS 신호 타임아웃 시작.
     * GPS_SIGNAL_TIMEOUT_MS 동안 업데이트가 없으면 신호 손실 처리.
     * 매 GPS 업데이트마다 호출해 타이머를 리셋한다.
     */
    const startGpsTimeout = () => {
      if (gpsTimeoutRef.current) clearTimeout(gpsTimeoutRef.current);
      gpsTimeoutRef.current = setTimeout(() => {
        setGpsLost(true);
        setSpeedKmh(0);
        setDeltaDistanceMFromGps(null);
        setError('GPS 신호가 끊겼습니다. 시간 기반으로 요금을 계산합니다.');
        // 손실 시점의 위치 참조를 제거해 복구 후 첫 업데이트가 오래된 좌표로 잘못된 거리를 계산하지 않도록 한다.
        lastLocationRef.current = null;
        lastSmoothedSpeedRef.current = null;
      }, GPS_SIGNAL_TIMEOUT_MS);
    };

    startGpsTimeout();

    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;

    // [FIX] async/await + try-catch 로 watchPositionAsync 오류 처리.
    // expo-location의 watchPositionAsync는 2개 인자만 지원하므로
    // 기존 3번째 인자(에러 콜백)는 제거하고 Promise rejection으로 처리한다.
    (async () => {
      try {
        const subscription = await Location.watchPositionAsync(
          LOCATION_WATCH_OPTIONS,
          (location) => {
            if (cancelled) return;

            // GPS 업데이트 수신 → 신호 복구 처리 및 타임아웃 리셋
            setGpsLost(false);
            setError(null);
            startGpsTimeout();

            const prev = lastLocationRef.current;
            const coords = location.coords;
            const timestamp = location.timestamp;

            if (
              coords.accuracy != null &&
              typeof coords.accuracy === 'number' &&
              coords.accuracy > MAX_ACCEPTABLE_ACCURACY_M
            ) {
              return;
            }

            const nativeSpeedMs =
              coords.speed != null &&
              typeof coords.speed === 'number' &&
              coords.speed >= 0
                ? coords.speed
                : null;

            let speedMs: number;
            let deltaM: number | null = null;
            let dtSec: number | null = null;

            if (prev && prev.coords) {
              const dtMs = timestamp - prev.timestamp;
              if (dtMs >= MIN_DT_MS) {
                const distM = haversineDistanceM(
                  prev.coords.latitude,
                  prev.coords.longitude,
                  coords.latitude,
                  coords.longitude
                );
                dtSec = dtMs / 1000;
                const computedSpeedMs = dtSec > 0 ? distM / dtSec : 0;
                speedMs = nativeSpeedMs != null ? nativeSpeedMs : computedSpeedMs;
                deltaM = distM;
              } else {
                speedMs = nativeSpeedMs ?? 0;
              }
            } else {
              speedMs = nativeSpeedMs ?? 0;
            }

            lastLocationRef.current = location;

            const kmhRaw = (speedMs * 3600) / 1000;
            const cappedRaw = Math.max(0, Math.min(MAX_SPEED_KMH, kmhRaw));
            const prevSmoothed = lastSmoothedSpeedRef.current;

            if (
              prevSmoothed != null &&
              dtSec != null &&
              dtSec > 0 &&
              cappedRaw - prevSmoothed > MAX_JUMP_PER_UPDATE_KMH
            ) {
              // 이상값: delta는 null로 두고 gpsUpdateId는 갱신하지 않는다
              setDeltaDistanceMFromGps(null);
              return;
            }

            const smoothed =
              prevSmoothed != null
                ? prevSmoothed + SMOOTHING_ALPHA * (cappedRaw - prevSmoothed)
                : cappedRaw;

            lastSmoothedSpeedRef.current = smoothed;
            setSpeedKmh(smoothed);
            setDeltaDistanceMFromGps(deltaM ?? null);
            // [FIX] 새 GPS 업데이트마다 카운터 증가 → useAccumulatedDistance가 중복 소비를 막는 데 사용
            setGpsUpdateId((id) => id + 1);
          }
        );

        if (cancelled) {
          subscription.remove();
        } else {
          sub = subscription;
          subscriptionRef.current = subscription;
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : '위치 정보를 가져올 수 없습니다.';
          setError(msg);
          setGpsLost(true);
          setSpeedKmh(0);
          setDeltaDistanceMFromGps(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (sub) {
        sub.remove();
        subscriptionRef.current = null;
      }
      if (gpsTimeoutRef.current) {
        clearTimeout(gpsTimeoutRef.current);
        gpsTimeoutRef.current = null;
      }
      lastLocationRef.current = null;
      lastSmoothedSpeedRef.current = null;
    };
  }, [isRunning, permissionStatus]);

  return {
    speedKmh,
    deltaDistanceMFromGps,
    gpsUpdateId,
    gpsLost,
    permissionStatus,
    isRequestingPermission,
    error,
    requestPermission,
  };
}
