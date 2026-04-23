import { useEffect, useRef, useState, FormEvent, TouchEvent, MouseEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { ArrowLeft, Volume2, VolumeX, Settings, Mic } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

export default function ParentStation({ onBack, initialSettings }: { onBack: () => void, initialSettings: {scanInterval: number, sensitivity: number} }) {
  const [roomId, setRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // Motion Alert
  const [motionAlertTime, setMotionAlertTime] = useState<string | null>(null);

  // Settings
  const [scanInterval, setScanInterval] = useState(initialSettings.scanInterval);
  const [sensitivity, setSensitivity] = useState(initialSettings.sensitivity);

  // PTT state
  const [isTalking, setIsTalking] = useState(false);
  
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    // Request microphone simply for PTT
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      .then(stream => {
        stream.getTracks().forEach(t => t.enabled = false); // default muted
        localAudioStreamRef.current = stream;
      }).catch(err => {
         console.error("PTT microphone denied", err);
      });

    return () => {
      socketRef.current?.disconnect();
      peerConnectionRef.current?.close();
      if (localAudioStreamRef.current) localAudioStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    if (roomId.length === 4) {
      setupSignaling(roomId);
      setIsJoined(true);
    }
  };

  const setupSignaling = (targetRoomId: string) => {
    const socketURL = window.location.origin;
    const socket = io(socketURL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', targetRoomId, 'parent');
    });

    socket.on('room-users', async (users) => {
      if (users.length > 0) {
        initiateCall(users[0]);
      } else {
        setErrorStatus("Waiting for Camera Unit to connect...");
      }
    });

    socket.on('user-joined', ({ id, role }) => {
      if (role === 'baby') {
        setErrorStatus(null);
        initiateCall(id);
      }
    });

    socket.on('answer', async (payload) => {
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
      }
    });

    socket.on('ice-candidate', (payload) => {
      const pc = peerConnectionRef.current;
      if (pc && payload.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(e => console.error(e));
      }
    });

    socket.on('motion-alert', (data) => {
       setMotionAlertTime(new Date(data.time).toLocaleTimeString([], { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
       
       // Trigger physical/audible alerts (Browser autoplay policy satisfied by 'Access Stream' button click)
       if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
       }
       
       try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();
          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.value = 880; // High pitch, faint beep
          // Envelope
          gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
       } catch (e) {
          console.warn("AudioContext failed to play alert beep", e);
       }

       setTimeout(() => setMotionAlertTime(null), 8000); // clear after 8s
    });
  };

  const initiateCall = async (targetSocketId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    // Attach local microphone for PTT
    if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach(track => {
            pc.addTrack(track, localAudioStreamRef.current!);
        });
    } else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    pc.addTransceiver('video', { direction: 'recvonly' });

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        // The first stream should contain both baby's camera and mic
        remoteVideoRef.current.srcObject = event.streams[0];
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
        setErrorStatus(null);
        // Sync settings upon connect
        syncSettings(scanInterval, sensitivity);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setIsConnected(false);
        setErrorStatus("Connection lost. Trying to reconnect...");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socketRef.current?.emit('offer', {
      target: targetSocketId,
      sender: socketRef.current?.id,
      description: pc.localDescription
    });
  };

  const syncSettings = (interval: number, sens: number) => {
      socketRef.current?.emit('update-settings', roomId, {
          scanInterval: interval,
          sensitivity: sens
      });
  };

  useEffect(() => {
     if (isConnected) syncSettings(scanInterval, sensitivity);
  }, [scanInterval, sensitivity]);

  const toggleMute = () => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !remoteVideoRef.current.muted;
      setIsMuted(remoteVideoRef.current.muted);
    }
  };

  const handleTalkStart = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      setIsTalking(true);
      if (localAudioStreamRef.current) {
          localAudioStreamRef.current.getTracks().forEach(t => t.enabled = true);
      }
  };

  const handleTalkEnd = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      setIsTalking(false);
      if (localAudioStreamRef.current) {
          localAudioStreamRef.current.getTracks().forEach(t => t.enabled = false);
      }
  };

  if (!isJoined) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 relative bg-[#121212]">
        <button onClick={onBack} className="absolute top-6 left-6 p-4">
          <ArrowLeft className="w-5 h-5 text-gray-400 hover:text-white" />
        </button>
        <motion.div 
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           className="w-full max-w-sm"
        >
          <div className="flex flex-col items-center">
            <h2 className="text-2xl font-light text-white uppercase tracking-widest mb-10">Pairing</h2>
            
            <form onSubmit={handleJoin} className="w-full space-y-12">
              <input
                type="text"
                maxLength={4}
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center text-[4rem] font-mono tracking-[0.3em] font-light bg-transparent border-b border-gray-800 focus:border-white outline-none text-white placeholder-gray-800 pb-4 transition-all"
                placeholder="0000"
                autoFocus
              />
              <button 
                type="submit"
                disabled={roomId.length !== 4}
                className="w-full py-5 border border-white/20 hover:border-white disabled:border-gray-800 disabled:text-gray-600 font-medium tracking-widest uppercase transition-all text-white text-xs"
              >
                Access Stream
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[#121212] relative">
       <div className="absolute top-0 inset-x-0 p-6 flex items-center justify-between z-10 bg-gradient-to-b from-[#121212]/90 to-transparent pt-10">
        <button 
          onClick={() => {
             socketRef.current?.disconnect();
             setIsJoined(false);
          }}
          className="p-3"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400 hover:text-white" />
        </button>

        <div className="flex items-center space-x-6">
           <AnimatePresence>
             {motionAlertTime !== null && (
                <motion.div 
                   initial={{ opacity: 0, scale: 0.9 }}
                   animate={{ opacity: 1, scale: 1 }}
                   exit={{ opacity: 0 }}
                   className="px-4 py-1.5 border-l-2 border-white bg-white/5 backdrop-blur-sm"
                >
                   <span className="text-[10px] text-white font-medium uppercase tracking-[0.2em]">Motion Detected</span>
                   <span className="block text-gray-500 text-[10px] tabular-nums mt-0.5">{motionAlertTime}</span>
                </motion.div>
             )}
           </AnimatePresence>

           <div className="text-right">
              <div className="text-[10px] tracking-[0.2em] text-gray-500 uppercase mb-1">Status</div>
              <div className={`text-[10px] uppercase tracking-widest font-medium ${isConnected ? 'text-white' : 'text-gray-600'}`}>
                  {isConnected ? "Connected" : "Lost Signal"}
              </div>
           </div>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-black/50 m-6 mb-32 shadow-2xl border border-white/10">
        {!isConnected && (
           <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
              <div className="text-[10px] text-gray-500 tracking-[0.3em] uppercase">{errorStatus || "Establishing connection..."}</div>
           </div>
        )}
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          playsInline
          className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-1000 ${isConnected ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>

      <div className="absolute bottom-6 inset-x-6 z-20">
          <div className="flex justify-between items-center bg-[#1E1E1E] p-1 border border-white/10 rounded-none shadow-2xl">
             <button 
               onClick={toggleMute}
               className={`p-6 w-1/4 flex justify-center items-center transition-all ${!isMuted ? 'text-white hover:bg-white/5' : 'text-gray-600 hover:bg-white/5'}`}
             >
               {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
             </button>
             
             <div className="w-px h-8 bg-white/10"></div>
             
             <button 
               onMouseDown={handleTalkStart}
               onMouseUp={handleTalkEnd}
               onMouseLeave={handleTalkEnd}
               onTouchStart={handleTalkStart}
               onTouchEnd={handleTalkEnd}
               className={`w-2/4 py-6 flex flex-col items-center justify-center transition-all ${isTalking ? 'bg-white text-black' : 'text-white hover:bg-white/5'}`}
             >
               <Mic className={`w-5 h-5 mb-2 ${isTalking ? 'animate-pulse' : ''}`} />
               <span className="text-[9px] uppercase tracking-[0.3em] font-medium">Hold to Talk</span>
             </button>

             <div className="w-px h-8 bg-white/10"></div>

             <button 
               onClick={() => setShowSettings(true)}
               className="p-6 w-1/4 flex justify-center items-center text-gray-400 hover:text-white transition-all hover:bg-white/5"
             >
               <Settings className="w-5 h-5" />
             </button>
          </div>
      </div>

      <AnimatePresence>
         {showSettings && (
             <motion.div 
                 initial={{ opacity: 0, y: 100 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: 100 }}
                 className="absolute inset-x-0 bottom-0 top-auto z-50 bg-[#1E1E1E] border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] flex flex-col p-8"
             >
                 <div className="flex justify-between items-center mb-10">
                     <h3 className="text-sm uppercase tracking-[0.2em] font-light text-white">Motion Configuration</h3>
                     <button onClick={() => setShowSettings(false)} className="text-xs text-gray-500 hover:text-white uppercase tracking-widest">Close</button>
                 </div>

                 <div className="space-y-10">
                     <div>
                         <div className="flex justify-between text-[10px] uppercase tracking-[0.1em] text-gray-400 mb-4">
                             <span>Scan Interval / Alert Cap</span>
                             <span className="text-white">{scanInterval} sec</span>
                         </div>
                         <input 
                            type="range" min="1" max="15" step="1" 
                            value={scanInterval} 
                            onChange={(e) => setScanInterval(parseInt(e.target.value))}
                            className="w-full h-1 bg-white/10 outline-none appearance-none cursor-pointer"
                         />
                     </div>
                     
                     <div className="pb-8">
                         <div className="flex justify-between text-[10px] uppercase tracking-[0.1em] text-gray-400 mb-4">
                             <span>Motion Sensitivity</span>
                             <span className="text-white">{sensitivity}%</span>
                         </div>
                         <input 
                            type="range" min="1" max="100" step="1" 
                            value={sensitivity} 
                            onChange={(e) => setSensitivity(parseInt(e.target.value))}
                            className="w-full h-1 bg-white/10 outline-none appearance-none cursor-pointer"
                         />
                         <p className="text-[10px] text-gray-500 mt-4 leading-relaxed max-w-xs">Higher sensitivity triggers alerts on the smallest pixel shifts inside the camera frame.</p>
                     </div>
                 </div>
             </motion.div>
         )}
      </AnimatePresence>
    </div>
  );
}
