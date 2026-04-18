import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import MainScreen from './screens/MainScreen';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <MainScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050507',
  },
});
