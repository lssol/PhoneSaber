import { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SensorFusion from './modules/sensor-fusion';

export default function App() {
  const [url, setUrl] = useState('ws://192.168.1.10:8080');
  const [status, setStatus] = useState('idle');
  const [rate, setRate] = useState(0);
  const wsRef = useRef(null);
  const sentRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setRate(sentRef.current * 2);
      sentRef.current = 0;
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const subR = SensorFusion.onRotation((e) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(`15,${e.t},${e.x},${e.y},${e.z},${e.w}`);
        sentRef.current++;
      }
    });
    const subA = SensorFusion.onAcceleration((e) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(`10,${e.t},${e.x},${e.y},${e.z}`);
        sentRef.current++;
      }
    });
    return () => { subR.remove(); subA.remove(); };
  }, []);

  const start = () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus('streaming');
      SensorFusion.start(20000); // ~50 Hz
    };
    ws.onerror = (e) => setStatus('error: ' + (e?.message ?? 'unknown'));
    ws.onclose = () => {
      SensorFusion.stop();
      setStatus('disconnected');
      runningRef.current = false;
    };
  };

  const stop = () => {
    SensorFusion.stop();
    wsRef.current?.close();
    wsRef.current = null;
    runningRef.current = false;
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>PhoneSaber</Text>
      <Text style={styles.label}>Server</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="ws://host:port"
        placeholderTextColor="#666"
      />
      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.btnStart]} onPress={start}>
          <Text style={styles.btnText}>Start</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnStop]} onPress={stop}>
          <Text style={styles.btnText}>Stop</Text>
        </Pressable>
      </View>
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.rate}>{rate.toFixed(0)} msg/s</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 80 },
  title: { color: '#3f3', fontSize: 32, fontWeight: 'bold', marginBottom: 40 },
  label: { color: '#888', fontSize: 13, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 14, borderRadius: 6, fontSize: 16, fontFamily: 'Menlo' },
  row: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, padding: 18, borderRadius: 6, alignItems: 'center' },
  btnStart: { backgroundColor: '#063' },
  btnStop: { backgroundColor: '#411' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  status: { color: '#aaa', marginTop: 24, fontSize: 16 },
  rate: { color: '#3f3', marginTop: 6, fontSize: 14, fontFamily: 'Menlo' },
});
