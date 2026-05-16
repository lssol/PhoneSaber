import { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SensorFusion from './modules/sensor-fusion';
import { encode } from './protocol';

const SAMPLE_INTERVAL_MICROS = 20000; // ~50 Hz

type ConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'streaming' }
  | { kind: 'disconnected' }
  | { kind: 'error'; message: string };

export default function App() {
  const [url, setUrl] = useState('ws://192.168.1.10:8080');
  const [status, setStatus] = useState<ConnectionStatus>({ kind: 'idle' });
  const [rate, setRate] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encode({ kind: 'rotation', t: e.t, x: e.x, y: e.y, z: e.z, w: e.w }));
        sentRef.current++;
      }
    });
    const subA = SensorFusion.onAcceleration((e) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encode({ kind: 'acceleration', t: e.t, x: e.x, y: e.y, z: e.z }));
        sentRef.current++;
      }
    });
    return () => {
      subR.remove();
      subA.remove();
    };
  }, []);

  const start = () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus({ kind: 'connecting' });
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus({ kind: 'streaming' });
      SensorFusion.start(SAMPLE_INTERVAL_MICROS);
    };
    ws.onerror = (e) => {
      const message = (e as { message?: string }).message ?? 'unknown';
      setStatus({ kind: 'error', message });
    };
    ws.onclose = () => {
      SensorFusion.stop();
      setStatus({ kind: 'disconnected' });
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
      <Text style={styles.status}>{renderStatus(status)}</Text>
      <Text style={styles.rate}>{rate.toFixed(0)} msg/s</Text>
    </View>
  );
}

function renderStatus(status: ConnectionStatus): string {
  switch (status.kind) {
    case 'idle':
      return 'idle';
    case 'connecting':
      return 'connecting';
    case 'streaming':
      return 'streaming';
    case 'disconnected':
      return 'disconnected';
    case 'error':
      return `error: ${status.message}`;
  }
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
