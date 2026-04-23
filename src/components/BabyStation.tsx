import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { CameraOff, Mic, MicOff, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

export default function BabyStation({ roomId, onBack, initialSettings }: { roomId: string, onBack: () => void, initialSettings: {scanInterval: number, sensitivity: number} }) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  // Settings
  const scanIntervalRef = useRef<number>(initialSettings.scanInterval);
  const sensitivityRef = useRef<number>(initialSettings.sensitivity);
  const lastScanRef = useRef<number>(Date.now());
  const prevFrameRef = useRef<ImageData | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  
  useEffect(() => {
    const initMedia = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true } 
        });
        setStream(mediaStream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = mediaStream;
        }
        setupSignaling(mediaStream);
        startMotionDetection();
      } catch (err) {
        console.error("Camera/Mic access denied", err);
        alert("Camera and microphone access is required for the Baby Station.");
      }
    };
    
    initMedia();
    
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      socketRef.current?.disconnect();
      peerConnectionRef.current?.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const setupSignaling = (mediaStream: MediaStream) => {
    const socketURL = window.location.origin;
    const socket = io(socketURL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', roomId, 'baby');
    });

    socket.on('user-joined', async ({ id, role }) => {
      if (role === 'parent') {
        const pc = createPeerConnection(id, mediaStream);
        peerConnectionRef.current = pc;
      }
    });

    socket.on('offer', async (payload) => {
      const pc = peerConnectionRef.current || createPeerConnection(payload.sender, mediaStream);
      if (!peerConnectionRef.current) peerConnectionRef.current = pc;

      await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('answer', {
        target: payload.sender,
        sender: socket.id,
        description: pc.localDescription
      });
    });

    socket.on('ice-candidate', (payload) => {
      const pc = peerConnectionRef.current;
      if (pc && payload.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(e => console.error(e));
      }
    });

    socket.on('update-settings', (settings) => {
        if (settings.scanInterval !== undefined) scanIntervalRef.current = settings.scanInterval;
        if (settings.sensitivity !== undefined) sensitivityRef.current = settings.sensitivity;
    });
  };

  const createPeerConnection = (targetSocketId: string, mediaStream: MediaStream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    mediaStream.getTracks().forEach(track => {
      pc.addTrack(track, mediaStream);
    });

    pc.ontrack = (event) => {
       if (remoteAudioRef.current && event.streams[0]) {
           remoteAudioRef.current.srcObject = event.streams[0];
       }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          target: targetSocketId,
          sender: socketRef.current.id,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setIsConnected(false);
      }
    };

    return pc;
  };

  const startMotionDetection = () => {
    const detect = () => {
       const now = Date.now();
       if (now - lastScanRef.current > scanIntervalRef.current * 1000) {
           performScan();
           lastScanRef.current = now;
       }
       animationFrameRef.current = requestAnimationFrame(detect);
    };
    animationFrameRef.current = requestAnimationFrame(detect);
  };

  const performScan = () => {
      const video = localVideoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      if (video.videoWidth === 0) return;

      // Use a fixed, highly downscaled resolution for robust structural analysis
      // Downscaling averages out ISO sensor noise natively, making it "future-proof" against false hardware alerts
      const scanWidth = 128;
      const scanHeight = 72;

      if (canvas.width !== scanWidth) {
          canvas.width = scanWidth;
          canvas.height = scanHeight;
      }
      
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, scanWidth, scanHeight);
      const currentFrame = ctx.getImageData(0, 0, scanWidth, scanHeight);

      if (prevFrameRef.current) {
          let diffPixels = 0;
          const totalPixels = scanWidth * scanHeight;
          
          // Sensitivity ranges from 1 to 100. Default 80.
          // thresholdBytes dictates how drastically a single pixel must change (0-255 luma scale).
          const thresholdBytes = 255 - Math.floor(sensitivityRef.current * 2.4); 
          const safeThreshold = Math.max(15, thresholdBytes); // Ensure base tolerance against camera buzz

          for (let i = 0; i < currentFrame.data.length; i += 4) {
               const r1 = currentFrame.data[i], g1 = currentFrame.data[i+1], b1 = currentFrame.data[i+2];
               const r2 = prevFrameRef.current.data[i], g2 = prevFrameRef.current.data[i+1], b2 = prevFrameRef.current.data[i+2];
               
               // Fast greyscale approximation
               const grey1 = (r1 + g1 + b1) / 3;
               const grey2 = (r2 + g2 + b2) / 3;
               
               if (Math.abs(grey1 - grey2) > safeThreshold) {
                    diffPixels++;
               }
          }
          
          const diffRatio = diffPixels / totalPixels;
          // Calculate scale of required pixel change to trigger the alert
          // at sensitivity 100 -> only ~0.2% screen change triggers it
          // at sensitivity 1 -> ~5% of entire screen needs to change
          const ratioThreshold = 0.002 + ((100 - sensitivityRef.current) / 100) * 0.048; 
          
          if (diffRatio > ratioThreshold && isConnected) {
               socketRef.current?.emit('motion-alert', roomId);
          }
      }
      prevFrameRef.current = currentFrame;
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#121212] relative">
      <audio ref={remoteAudioRef} autoPlay />
      <canvas ref={canvasRef} className="hidden" />

      <div className="absolute top-0 inset-x-0 p-6 flex justify-between items-start z-10 bg-gradient-to-b from-[#121212]/80 to-transparent">
        <button 
          onClick={onBack}
          className="p-3 bg-[#1E1E1E]/80 backdrop-blur-md rounded-full border border-white/10 hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        
        <div className="flex flex-col items-end space-y-2">
          <div className="px-6 py-4 bg-[#1E1E1E]/80 backdrop-blur-md rounded-2xl border border-white/10 flex flex-col items-center">
            <span className="text-[10px] text-gray-400 font-semibold tracking-[0.2em] uppercase mb-2">Pairing Code</span>
            <span className="text-4xl font-mono text-white tracking-[0.2em]">{roomId}</span>
          </div>
          <div className={`px-4 py-2 text-[10px] uppercase tracking-widest font-medium border ${isConnected ? 'bg-white/10 text-white border-white/20' : 'bg-transparent text-gray-500 border-white/10'}`}>
            {isConnected ? "Linked to Parent" : "Awaiting Connection"}
          </div>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-black/50 m-6 shadow-2xl border border-white/10">
        <video 
          ref={localVideoRef} 
          autoPlay 
          playsInline 
          muted 
          className={`absolute inset-0 w-full h-full object-cover scale-x-[-1] transition-opacity ${isVideoEnabled ? 'opacity-100' : 'opacity-0'}`}
        />
        {!isVideoEnabled && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm">
            <CameraOff className="w-10 h-10 text-white/20" />
          </div>
        )}
      </div>

      <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center items-center gap-6 bg-gradient-to-t from-[#121212] via-[#121212]/80 to-transparent z-10">
        <button 
          onClick={toggleAudio}
          className={`p-6 border transition-all ${isAudioEnabled ? 'bg-[#1E1E1E] border-white/20 text-white' : 'bg-transparent border-white/10 text-gray-600'}`}
        >
          {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>
        <button 
          onClick={toggleVideo}
          className={`p-6 border transition-all ${isVideoEnabled ? 'bg-[#1E1E1E] border-white/20 text-white' : 'bg-transparent border-white/10 text-gray-600'}`}
        >
          {isVideoEnabled ? <CameraOff className="w-5 h-5 hidden" /> : <CameraOff className="w-5 h-5" />}
          {isVideoEnabled && <div className="w-5 h-5 rounded-full border-2 border-white"></div>}
        </button>
      </div>
    </div>
  );
}
