import { useEffect, useState } from 'react';

export type SpeedLevel = 'idle' | 'low' | 'mid' | 'high';

export type SpeedMetrics = {
  speedKmh: number;
  distanceKm: number;
  elapsedSeconds: number;
  level: SpeedLevel;
};

// 현재는 expo-location 패키지가 설치되지 않아,
// GPS 대신 "정적/테스트용" 속도 값을 사용하는 훅입니다.
// expo-location 설치 후 실제 위치 기반으로 교체하면 됩니다.
export function useSpeedMetrics(): SpeedMetrics {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 테스트용: 0~12km/h 사이를 천천히 오르내리는 가짜 속도
  const speedKmh = Math.max(
    0,
    6 + 6 * Math.sin(elapsedSeconds / 10),
  );
  const distanceKm = (speedKmh / 3600) * elapsedSeconds;

  let level: SpeedLevel = 'idle';
  if (speedKmh < 0.5) level = 'idle';
  else if (speedKmh < 5) level = 'low';
  else if (speedKmh < 12) level = 'mid';
  else level = 'high';

  return { speedKmh, distanceKm, elapsedSeconds, level };
}


