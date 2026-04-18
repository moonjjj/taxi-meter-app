import { useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';

/** 두 위경도 사이 거리(m). Haversine 근사 */
function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
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
  /** 이번 틱에 이동한 거리(m). 요금/누적거리용. 위치 갱신이 없으면 undefined */
  deltaDistanceMFromGps: number | null | undefined;
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

/**
 * 실제 GPS 위치 기반 속도 훅.
 * - isRunning일 때만 위치 감시를 시작하고, 이전 위치와 비교해 속도 계산.
 * - coords.speed(m/s)가 유효하면 사용, 없으면 거리/시간으로 계산.
 * - 계산된 속도를 기존 요금·거리 로직에 연결할 수 있도록 speedKmh, deltaDistanceMFromGps 반환.
 */
export function useGpsSpeed(isRunning: boolean): GpsSpeedResult {
  const [speedKmh, setSpeedKmh] = useState(0);
  const [deltaDistanceMFromGps, setDeltaDistanceMFromGps] = useState<
    number | null | undefined
  >(undefined);
  const [permissionStatus, setPermissionStatus] = useState<
    'undetermined' | 'granted' | 'denied'
  >('undetermined');
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastLocationRef = useRef<Location.LocationObject | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastSmoothedSpeedRef = useRef<number | null>(null);

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

  // 권한 확인 (앱 로드 시 한 번)
  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (!cancelled) {
        setPermissionStatus(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // isRunning일 때만 위치 감시
  useEffect(() => {
    if (!isRunning) {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      lastLocationRef.current = null;
      setSpeedKmh(0);
      setDeltaDistanceMFromGps(undefined);
      return;
    }

    if (permissionStatus !== 'granted') {
      setSpeedKmh(0);
      setDeltaDistanceMFromGps(undefined);
      return;
    }

    setError(null);

    let subscription: Location.LocationSubscription | null = null;

    Location.watchPositionAsync(
      LOCATION_WATCH_OPTIONS,
      (location) => {
        const prev = lastLocationRef.current;
        const coords = location.coords;
        const timestamp = location.timestamp;

        // 정확도(accuracy)가 너무 나쁘면 이 샘플은 버린다.
        if (
          coords.accuracy != null &&
          typeof coords.accuracy === 'number' &&
          coords.accuracy > MAX_ACCEPTABLE_ACCURACY_M
        ) {
          return;
        }

        // 네이티브 speed(m/s)가 유효하면 사용
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
            speedMs =
              nativeSpeedMs != null
                ? nativeSpeedMs
                : computedSpeedMs;
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

        // 갑자기 너무 크게 튀는 값은(이전보다 N km/h 이상 급증) 노이즈로 판단해 버린다.
        if (
          prevSmoothed != null &&
          dtSec != null &&
          dtSec > 0 &&
          cappedRaw - prevSmoothed > MAX_JUMP_PER_UPDATE_KMH
        ) {
          setDeltaDistanceMFromGps(null);
          return;
        }

        let smoothed = cappedRaw;
        if (prevSmoothed != null) {
          smoothed =
            prevSmoothed + SMOOTHING_ALPHA * (cappedRaw - prevSmoothed);
        }

        lastSmoothedSpeedRef.current = smoothed;
        setSpeedKmh(smoothed);
        setDeltaDistanceMFromGps(deltaM ?? null);
      },
      (reason) => {
        setError(reason ?? '위치 정보를 가져올 수 없습니다.');
        setSpeedKmh(0);
        setDeltaDistanceMFromGps(undefined);
      }
    ).then((sub) => {
      subscription = sub;
      subscriptionRef.current = sub;
    });

    return () => {
      if (subscription) {
        subscription.remove();
        subscriptionRef.current = null;
      }
      lastLocationRef.current = null;
    };
  }, [isRunning, permissionStatus]);

  return {
    speedKmh,
    deltaDistanceMFromGps,
    permissionStatus,
    isRequestingPermission,
    error,
    requestPermission,
  };
}
