import { useState, useEffect } from 'react';
import { Camera, MonitorSmartphone, Settings as SettingsIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import BabyStation from './components/BabyStation';
import ParentStation from './components/ParentStation';

export type Role = 'baby' | 'parent' | null;

export interface AppSettings {
  scanInterval: number;
  sensitivity: number;
}

export default function App() {
  const [role, setRole] = useState<Role>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({ scanInterval: 5, sensitivity: 80 });

  useEffect(() => {
    const saved = localStorage.getItem('cribby_settings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('cribby_settings', JSON.stringify(newSettings));
  };

  const generateRoomId = () => {
    return Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit code
  };

  const handleStartBaby = () => {
    setRoomId(generateRoomId());
    setRole('baby');
  };

  if (role === 'baby') {
    return <BabyStation roomId={roomId} onBack={() => setRole(null)} initialSettings={settings} />;
  }

  if (role === 'parent') {
    return <ParentStation onBack={() => setRole(null)} initialSettings={settings} />;
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen p-6 text-center relative bg-[#121212]">
      <div className="absolute top-6 right-6">
        <button 
          onClick={() => setShowSettings(true)}
          className="p-3 border border-white/10 rounded-full hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full"
      >
        <div className="mb-12">
          <h1 className="text-4xl font-light tracking-[0.2em] uppercase mb-4 text-white">Cribby</h1>
          <p className="text-gray-500 text-sm max-w-sm mx-auto tracking-wide">
            Minimalist Local Monitor.
          </p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={handleStartBaby}
            className="w-full flex items-center justify-between p-6 bg-[#1E1E1E] border border-white/10 hover:border-white/40 rounded-xl transition-all group"
          >
            <div className="flex items-center space-x-4">
              <Camera className="w-5 h-5 text-gray-400 group-hover:text-white" />
              <div className="text-left">
                <h2 className="text-white font-medium text-lg leading-tight uppercase tracking-wider">Camera Unit</h2>
              </div>
            </div>
            <div className="text-gray-600 group-hover:text-white px-2">→</div>
          </button>

          <button 
            onClick={() => setRole('parent')}
            className="w-full flex items-center justify-between p-6 bg-[#1E1E1E] border border-white/10 hover:border-white/40 rounded-xl transition-all group"
          >
            <div className="flex items-center space-x-4">
              <MonitorSmartphone className="w-5 h-5 text-gray-400 group-hover:text-white" />
              <div className="text-left">
                <h2 className="text-white font-medium text-lg leading-tight uppercase tracking-wider">Parent Unit</h2>
              </div>
            </div>
            <div className="text-gray-600 group-hover:text-white px-2">→</div>
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
         {showSettings && (
             <motion.div 
                 initial={{ opacity: 0, y: 100 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: 100 }}
                 className="absolute inset-x-0 bottom-0 top-auto z-50 bg-[#1E1E1E] border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] flex flex-col p-8 text-left"
             >
                 <div className="flex justify-between items-center mb-10">
                     <h3 className="text-sm uppercase tracking-[0.2em] font-light text-white">Global Settings</h3>
                     <button onClick={() => setShowSettings(false)} className="text-xs text-gray-500 hover:text-white uppercase tracking-widest"><X className="w-5 h-5"/></button>
                 </div>

                 <div className="space-y-10">
                     <div>
                         <div className="flex justify-between text-[10px] uppercase tracking-[0.1em] text-gray-400 mb-4">
                             <span>Motion Scan Rate / Alert Cap</span>
                             <span className="text-white">{settings.scanInterval} sec</span>
                         </div>
                         <input 
                            type="range" min="1" max="15" step="1" 
                            value={settings.scanInterval} 
                            onChange={(e) => saveSettings({ ...settings, scanInterval: parseInt(e.target.value) })}
                            className="w-full h-1 bg-white/10 outline-none appearance-none cursor-pointer"
                         />
                         <p className="text-[10px] text-gray-500 mt-4 leading-relaxed max-w-xs">How often the camera will scan for motion and send an alert to the parent unit.</p>
                     </div>
                     
                     <div className="pb-8">
                         <div className="flex justify-between text-[10px] uppercase tracking-[0.1em] text-gray-400 mb-4">
                             <span>Motion Sensitivity</span>
                             <span className="text-white">{settings.sensitivity}%</span>
                         </div>
                         <input 
                            type="range" min="1" max="100" step="1" 
                            value={settings.sensitivity} 
                            onChange={(e) => saveSettings({ ...settings, sensitivity: parseInt(e.target.value) })}
                            className="w-full h-1 bg-white/10 outline-none appearance-none cursor-pointer"
                         />
                         <p className="text-[10px] text-gray-500 mt-4 leading-relaxed max-w-xs">Higher sensitivity triggers alerts on the smallest movements inside the camera frame.</p>
                     </div>
                 </div>
             </motion.div>
         )}
      </AnimatePresence>
    </div>
  );
}
