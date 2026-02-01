import express from 'express';
import http from 'http';
import { SerialPort } from 'serialport';

const app = express();
const server = http.createServer(app);
const port = 3000;

app.use(express.static('public'));
app.use(express.json());

let arduinoPort: SerialPort | null = null;
let clients: any[] = [];

// ★ [핵심] 조각난 데이터를 임시로 모아둘 변수 (접착제 역할)
let serialBuffer: string = ""; 

// 1. 포트 목록
app.get('/api/ports', async (req, res) => {
    try {
        const ports = await SerialPort.list();
        const portPaths = ports.map(p => p.path);
        res.json(portPaths);
    } catch (err: any) {
        res.status(500).send(err.message);
    }
});

// 2. 포트 연결
app.post('/api/connect', (req, res) => {
    const { port } = req.body;
    
    if (arduinoPort && arduinoPort.isOpen) {
        arduinoPort.close();
    }

    if (port === 'TEST (Virtual Mode)') {
        res.json({ message: '테스트 모드 연결됨' });
        return;
    }

    // 115200bps 설정
    arduinoPort = new SerialPort({ 
        path: port, 
        baudRate: 115200, 
        autoOpen: false 
    });

    // ★ [수정됨] 완벽한 파싱 로직 (조각 모음)
    arduinoPort.on('data', (chunk: Buffer) => {
        // 1. 들어온 조각을 일단 버퍼에 붙임
        serialBuffer += chunk.toString('utf8');

        // 2. 줄바꿈(\n)이 있는지 확인 (문장이 끝났는지)
        if (serialBuffer.includes('\n')) {
            // 줄바꿈 기준으로 쪼갬
            const lines = serialBuffer.split(/\r?\n/);

            // 마지막 조각은 아직 덜 온 것일 수 있으므로 다시 버퍼에 넣음
            // (예: "Pulse Wid" 까지만 왔으면 다음 조각을 위해 남겨둠)
            serialBuffer = lines.pop() || "";

            // 3. 완성된 문장들만 하나씩 검사
            for (const line of lines) {
                if (!line.trim()) continue;

                // 디버깅용 로그 (이제 깔끔한 한 줄로 보일 겁니다)
                console.log(`📜 완성된 문장: ${line}`);

                // [FALL] 감지 -> 시작 (Active Low: 누름)
                if (line.includes('[FALL]')) {
                    console.log("🚀 START 신호 전송 (누름)");
                    broadcast({ type: 'START' });
                }

                // Pulse Width 감지 -> 종료 (Active Low: 뗌)
                const pulseMatch = line.match(/Pulse Width:\s*(\d+)/);
                if (pulseMatch) {
                    const val = parseInt(pulseMatch[1]);
                    console.log(`🎯 END 신호 전송 (뗌): ${val}ms`);
                    broadcast({ type: 'END', value: val });
                }
            }
        }
    });

    arduinoPort.open((err) => {
        if (err) {
            console.log("포트 열기 실패:", err.message);
            res.status(500).json({ message: 'Error: ' + err.message });
        } else {
            console.log(`${port} 포트 열림! (115200) - 조각 모음 모드`);
            // 연결 시 버퍼 초기화
            serialBuffer = "";
            res.json({ message: `${port} 연결 성공!` });
        }
    });
});

function broadcast(dataObj: any) {
    const jsonStr = JSON.stringify(dataObj);
    clients.forEach(client => {
        client.res.write(`data: ${jsonStr}\n\n`);
    });
}

app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
});

server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});