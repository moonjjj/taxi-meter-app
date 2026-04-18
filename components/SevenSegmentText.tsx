import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

type SevenSegmentTextProps = {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'fare';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  style?: ViewStyle;
};

export const sizeMap = {
  sm: { width: 10, height: 18, thickness: 2, margin: 1 },
  md: { width: 14, height: 24, thickness: 3, margin: 2 },
  lg: { width: 18, height: 30, thickness: 3, margin: 3 },
  xl: { width: 22, height: 36, thickness: 4, margin: 3 },
} as const;

export const ON_PRIMARY = '#6FF7FF';
export const ON_SECONDARY = '#3BD4E0';
export const ON_FARE = '#FF4444';
export const OFF_SEGMENT = '#12323A';
export const OFF_SEGMENT_FARE = '#2A1515';

export type DigitProps = {
  ch: string;
  color: string;
  offColor?: string;
  width: number;
  height: number;
  thickness: number;
};

const digitMap: Record<string, [boolean, boolean, boolean, boolean, boolean, boolean, boolean]> = {
  // a, b, c, d, e, f, g
  '0': [true, true, true, true, true, true, false],
  '1': [false, true, true, false, false, false, false],
  '2': [true, true, false, true, true, false, true],
  '3': [true, true, true, true, false, false, true],
  '4': [false, true, true, false, false, true, true],
  '5': [true, false, true, true, false, true, true],
  '6': [true, false, true, true, true, true, true],
  '7': [true, true, true, false, false, false, false],
  '8': [true, true, true, true, true, true, true],
  '9': [true, true, true, true, false, true, true],
};

export const SevenDigit: React.FC<DigitProps> = ({
  ch,
  color,
  offColor = OFF_SEGMENT,
  width,
  height,
  thickness,
}) => {
  if (ch === ' ') {
    return <View style={{ width: width + thickness * 2 }} />;
  }

  if (ch === ':') {
    const dotSize = thickness;
    const gap = thickness * 2;
    return (
      <View
        style={[
          styles.digitContainer,
          {
            width,
            height,
            justifyContent: 'center',
            alignItems: 'center',
          },
        ]}
      >
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            marginBottom: gap / 2,
            shadowColor: color,
            shadowOpacity: 0.8,
            shadowRadius: 4,
          }}
        />
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            marginTop: gap / 2,
            shadowColor: color,
            shadowOpacity: 0.8,
            shadowRadius: 4,
          }}
        />
      </View>
    );
  }

  if (ch === '.') {
    const dotSize = thickness;
    return (
      <View
        style={[
          styles.digitContainer,
          { width, height, justifyContent: 'flex-end', alignItems: 'flex-end' },
        ]}
      >
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            marginRight: thickness / 2,
            marginBottom: thickness / 2,
            shadowColor: color,
            shadowOpacity: 0.8,
            shadowRadius: 4,
          }}
        />
      </View>
    );
  }

  const pattern = digitMap[ch] || [false, false, false, false, false, false, false];

  const segCommon: ViewStyle = {
    position: 'absolute',
    borderRadius: thickness,
  };

  const horizontalLength = width;
  const verticalLength = height / 2 - thickness;

  const onStyle: ViewStyle = {
    backgroundColor: color,
    shadowColor: color,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  };

  const offStyle: ViewStyle = {
    backgroundColor: offColor,
    shadowOpacity: 0,
  };

  return (
    <View style={[styles.digitContainer, { width, height }]}>
      {/* a - top */}
      <View
        style={[
          segCommon,
          {
            top: 0,
            left: thickness,
            width: horizontalLength - thickness * 2,
            height: thickness,
          },
          pattern[0] ? onStyle : offStyle,
        ]}
      />
      {/* b - top right */}
      <View
        style={[
          segCommon,
          {
            top: thickness,
            right: 0,
            width: thickness,
            height: verticalLength - thickness,
          },
          pattern[1] ? onStyle : offStyle,
        ]}
      />
      {/* c - bottom right */}
      <View
        style={[
          segCommon,
          {
            bottom: thickness,
            right: 0,
            width: thickness,
            height: verticalLength - thickness,
          },
          pattern[2] ? onStyle : offStyle,
        ]}
      />
      {/* d - bottom */}
      <View
        style={[
          segCommon,
          {
            bottom: 0,
            left: thickness,
            width: horizontalLength - thickness * 2,
            height: thickness,
          },
          pattern[3] ? onStyle : offStyle,
        ]}
      />
      {/* e - bottom left */}
      <View
        style={[
          segCommon,
          {
            bottom: thickness,
            left: 0,
            width: thickness,
            height: verticalLength - thickness,
          },
          pattern[4] ? onStyle : offStyle,
        ]}
      />
      {/* f - top left */}
      <View
        style={[
          segCommon,
          {
            top: thickness,
            left: 0,
            width: thickness,
            height: verticalLength - thickness,
          },
          pattern[5] ? onStyle : offStyle,
        ]}
      />
      {/* g - middle */}
      <View
        style={[
          segCommon,
          {
            top: height / 2 - thickness / 2,
            left: thickness,
            width: horizontalLength - thickness * 2,
            height: thickness,
          },
          pattern[6] ? onStyle : offStyle,
        ]}
      />
    </View>
  );
};

export const SevenSegmentText: React.FC<SevenSegmentTextProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  style,
}) => {
  const { width, height, thickness, margin } = sizeMap[size];
  const color =
    variant === 'fare' ? ON_FARE : variant === 'primary' ? ON_PRIMARY : ON_SECONDARY;
  const offColor = variant === 'fare' ? OFF_SEGMENT_FARE : OFF_SEGMENT;

  const str = React.Children.toArray(children)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('');

  return (
    <View style={[styles.row, style]}>
      {str.split('').map((ch, idx) => (
        <View key={`${ch}-${idx}`} style={{ marginHorizontal: margin / 2 }}>
          <SevenDigit
            ch={ch}
            color={color}
            offColor={offColor}
            width={width}
            height={height}
            thickness={thickness}
          />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  digitContainer: {
    backgroundColor: '#000000',
  },
});

export default SevenSegmentText;


