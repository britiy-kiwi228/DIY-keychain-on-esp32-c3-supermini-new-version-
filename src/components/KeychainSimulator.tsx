/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Battery, Zap, Power, Wifi, RefreshCw, Terminal, Eye, Volume2, ShieldCheck } from 'lucide-react';
import { calculateBatteryPercentage, evaluateButtonPress, getNextSlot } from '../utils/keychainLogic.ts';

export interface KeychainSimulatorProps {
  currentSlot: number;
  onSlotChange: (slot: number) => void;
  onOpenPortal: () => void;
  logs: string[];
  addLog: (msg: string, type?: 'info' | 'success' | 'crimson' | 'cyan') => void;
  slotImages: Record<number, { isGif: boolean; url: string; name: string }>;
}

export function KeychainSimulator({
  currentSlot,
  onSlotChange,
  onOpenPortal,
  logs,
  addLog,
  slotImages,
}: KeychainSimulatorProps) {
  // Simulator state
  const [fsmState, setFsmState] = useState<'PLAYBACK' | 'PORTAL' | 'CHARGING_SLEEP' | 'LOW_POWER_SLEEP'>('PLAYBACK');
  const [batteryMv, setBatteryMv] = useState<number>(3920);
  const [isUsbConnected, setIsUsbConnected] = useState<boolean>(false);
  const [isPressingButton, setIsPressingButton] = useState<boolean>(false);
  const [pressStart, setPressStart] = useState<number>(0);
  const [pressDuration, setPressDuration] = useState<number>(0);
  const [qrMode, setQrMode] = useState<'WIFI' | 'PORTAL'>('WIFI');

  const timerRef = useRef<number | null>(null);

  const batteryPercent = calculateBatteryPercentage(batteryMv);

  // Button press timer
  useEffect(() => {
    if (isPressingButton) {
      const interval = window.setInterval(() => {
        setPressDuration(Date.now() - pressStart);
      }, 50);
      timerRef.current = interval;
      return () => clearInterval(interval);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setPressDuration(0);
    }
  }, [isPressingButton, pressStart]);

  // Handle Button Press down
  const handleButtonDown = () => {
    setIsPressingButton(true);
    setPressStart(Date.now());
  };

  // Handle Button Release
  const handleButtonUp = () => {
    if (!isPressingButton) return;
    const duration = Date.now() - pressStart;
    setIsPressingButton(false);

    if (fsmState === 'LOW_POWER_SLEEP') {
      setFsmState('PLAYBACK');
      addLog('[SYSTEM] Woke up from Low-Power Sleep on GPIO 10!', 'success');
      return;
    }

    const action = evaluateButtonPress(duration);

    if (action === 'SHORT_CLICK') {
      if (fsmState === 'PLAYBACK') {
        const next = getNextSlot(currentSlot, 3);
        onSlotChange(next);
        addLog(`[BUTTON] Short Click (${duration}ms) -> Switched to Slot ${next}`, 'cyan');
      } else if (fsmState === 'PORTAL') {
        setQrMode(prev => (prev === 'WIFI' ? 'PORTAL' : 'WIFI'));
        addLog(`[BUTTON] Short Click -> Toggled QR View to ${qrMode === 'WIFI' ? 'Direct IP' : 'Wi-Fi'}`, 'info');
      }
    } else if (action === 'LONG_PRESS') {
      if (fsmState === 'PLAYBACK') {
        setFsmState('PORTAL');
        addLog(`[FSM] Long Press (${duration}ms) -> STATE_PORTAL live (160MHz, SoftAP active)`, 'crimson');
        onOpenPortal();
      } else if (fsmState === 'PORTAL') {
        setFsmState('PLAYBACK');
        addLog(`[FSM] Long Press (${duration}ms) -> Exiting portal, return to STATE_PLAYBACK (80MHz)`, 'info');
      }
    } else if (action === 'DEEP_SLEEP') {
      setFsmState('LOW_POWER_SLEEP');
      addLog(`[SYSTEM] Extra-long press (${duration}ms) -> Entered Low-Power Sleep (130µA). Wake on GPIO 10`, 'crimson');
    }
  };

  // USB Charging detection
  const toggleUsb = () => {
    const nextState = !isUsbConnected;
    setIsUsbConnected(nextState);
    if (nextState) {
      setFsmState('CHARGING_SLEEP');
      addLog('[FSM] VBUS 5V detected via GPIO 1 divider -> STATE_CHARGING_SLEEP (Display SLPIN)', 'crimson');
    } else {
      setFsmState('PLAYBACK');
      addLog('[FSM] VBUS 5V disconnected -> Waking display (SLPOUT) -> STATE_PLAYBACK', 'success');
    }
  };

  return (
    <div className="flex flex-col lg:flex-row items-center justify-center gap-8 py-4">
      {/* Visual Keychain Hardware Prototype */}
      <div className="relative flex flex-col items-center">
        {/* Keychain Ring Loop & Chain */}
        <div className="flex flex-col items-center -mb-3 z-0">
          <div className="w-10 h-10 rounded-full border-4 border-slate-500 shadow-md bg-transparent" />
          <div className="w-2 h-4 bg-slate-600 rounded-sm" />
          <div className="w-6 h-3 bg-slate-700 rounded-t-md" />
        </div>

        {/* Acrylic / CNC Metal Bezel Enclosure */}
        <div className="relative w-72 h-72 rounded-full bg-gradient-to-br from-slate-800 via-slate-900 to-black p-3 shadow-2xl border-4 border-slate-700 flex items-center justify-center">
          {/* Bezel Screw Notches (Top, Bottom, Left, Right) */}
          <div className="absolute top-2 w-2.5 h-2.5 rounded-full bg-slate-500 border border-slate-800 shadow-inner" />
          <div className="absolute bottom-2 w-2.5 h-2.5 rounded-full bg-slate-500 border border-slate-800 shadow-inner" />
          <div className="absolute left-2 w-2.5 h-2.5 rounded-full bg-slate-500 border border-slate-800 shadow-inner" />
          <div className="absolute right-2 w-2.5 h-2.5 rounded-full bg-slate-500 border border-slate-800 shadow-inner" />

          {/* Physical Tactile Button on the top-right edge */}
          <div className="absolute -top-3 right-12 z-20">
            <button
              onMouseDown={handleButtonDown}
              onMouseUp={handleButtonUp}
              onTouchStart={handleButtonDown}
              onTouchEnd={handleButtonUp}
              aria-label="Tactile push button GPIO 10"
              className={`px-3 py-1 text-xs font-mono rounded-t-lg transition-transform border border-slate-600 shadow-lg ${
                isPressingButton
                  ? 'bg-rose-600 text-white translate-y-1'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}
              title="Tactile Button (GPIO 10): Click to cycle slot, Hold 2.5s for Portal, Hold 5s for Sleep"
            >
              BTN (GPIO 10)
            </button>
            {isPressingButton && (
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-mono text-rose-400 bg-black/80 px-1 rounded whitespace-nowrap">
                {(pressDuration / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {/* Type-C USB Port at the bottom */}
          <div className="absolute -bottom-2 z-20">
            <button
              onClick={toggleUsb}
              className={`px-3 py-0.5 text-[10px] font-mono rounded-b-md border transition-colors ${
                isUsbConnected
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="Toggle USB 5V Charging Sense"
            >
              {isUsbConnected ? '⚡ USB 5V PLUGGED' : 'USB-C'}
            </button>
          </div>

          {/* Inner 1.28" Round Screen (ST7789 240x240 IPS) */}
          <div className="relative w-56 h-56 rounded-full overflow-hidden bg-black shadow-inner flex items-center justify-center border-2 border-slate-800">
            {/* Screen Glass Reflection */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-white/15 pointer-events-none z-20" />

            {/* CRT Scanline Filter Overlay */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none z-10 opacity-30"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, rgba(0,0,0,0.4) 0px, rgba(0,0,0,0.4) 1px, transparent 1px, transparent 2px)',
              }}
            />

            {/* SCREEN CONTENT BASED ON FSM STATE */}
            {fsmState === 'LOW_POWER_SLEEP' || fsmState === 'CHARGING_SLEEP' ? (
              <div className="flex flex-col items-center justify-center text-center p-4">
                {fsmState === 'CHARGING_SLEEP' ? (
                  <>
                    <Zap className="w-8 h-8 text-amber-400 animate-pulse mb-2" />
                    <span className="text-xs font-mono text-amber-400 tracking-wider">CHARGING...</span>
                    <span className="text-[10px] font-mono text-slate-400 mt-1">
                      {batteryMv}mV ({batteryPercent}%)
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 mt-2">Display SLPIN (Power Save)</span>
                  </>
                ) : (
                  <>
                    <Power className="w-8 h-8 text-slate-600 mb-2" />
                    <span className="text-xs font-mono text-slate-500">LOW-POWER SLEEP</span>
                    <span className="text-[9px] font-mono text-slate-600 mt-2">Press button to wake</span>
                  </>
                )}
              </div>
            ) : fsmState === 'PORTAL' ? (
              /* SoftAP Captive Portal QR Code Display */
              <div className="flex flex-col items-center justify-center p-2 text-center text-cyan-400">
                <span className="text-[10px] font-mono font-bold tracking-widest text-cyan-300">WIRED KEYCHAIN</span>
                {/* Simulated High Contrast QR Code Canvas */}
                <div className="w-28 h-28 bg-white p-2 rounded-sm shadow-md my-1 flex items-center justify-center">
                  <div className="grid grid-cols-6 gap-0.5 w-full h-full p-1 bg-black">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <div
                        key={i}
                        className={`${
                          (i * 7 + 3) % 4 === 0 || i % 5 === 0 || i < 8 || i > 28 ? 'bg-white' : 'bg-black'
                        } rounded-[1px]`}
                      />
                    ))}
                  </div>
                </div>
                <span className="text-[9px] font-mono font-bold text-white bg-slate-900/90 px-2 py-0.5 rounded">
                  {qrMode === 'WIFI' ? 'SSID: WIRED_KEYCHAIN' : 'URL: 192.168.4.1'}
                </span>
                <span className="text-[8px] font-mono text-slate-400 mt-0.5">[CLICK: SWITCH | HOLD: EXIT]</span>
              </div>
            ) : (
              /* Normal Animated GIF / Image Playback Mode */
              <div className="relative w-full h-full flex items-center justify-center">
                {slotImages[currentSlot]?.url ? (
                  <img
                    src={slotImages[currentSlot].url}
                    alt={`Slot ${currentSlot} Animation`}
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center p-4">
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-cyan-500/50 flex items-center justify-center mb-2 animate-spin-slow">
                      <span className="text-xs font-mono font-bold text-cyan-400">SLOT {currentSlot}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-300 font-bold">SLOT 0{currentSlot} ACTIVE</span>
                    <span className="text-[9px] font-mono text-slate-500">Hold 2.5s to open Web Portal</span>
                  </div>
                )}

                {/* Subtle HUD Overlay */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 backdrop-blur-xs px-2 py-0.5 rounded-full border border-slate-700/50">
                  <span className="text-[9px] font-mono text-cyan-400 font-bold">SLOT 0{currentSlot}</span>
                  <span className="text-[8px] font-mono text-slate-400">·</span>
                  <span className="text-[9px] font-mono text-emerald-400">{batteryPercent}%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Device State Pills */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="px-2.5 py-1 rounded bg-slate-800 text-[11px] font-mono text-slate-300 border border-slate-700">
            FSM: <strong className="text-cyan-400">{fsmState}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-[11px] font-mono text-slate-300 border border-slate-700">
            CPU: <strong className="text-amber-400">{fsmState === 'PORTAL' ? '160 MHz' : '80 MHz'}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-[11px] font-mono text-slate-300 border border-slate-700">
            Wi-Fi: <strong className={fsmState === 'PORTAL' ? 'text-emerald-400' : 'text-slate-500'}>
              {fsmState === 'PORTAL' ? 'SoftAP ON' : 'OFF (0mA)'}
            </strong>
          </span>
        </div>
      </div>

      {/* Hardware Telemetry & Quick Action Controls */}
      <div className="flex flex-col w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <h3 className="font-mono text-sm font-bold text-white tracking-wide">ESP32-C3 HARDWARE CONTROL</h3>
          </div>
          <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            LIVE
          </span>
        </div>

        {/* Battery Simulation Slider */}
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Battery className="w-4 h-4 text-emerald-400" />
              Li-Po Battery (ADC1_CH0 / GPIO 0):
            </span>
            <span className="text-emerald-400 font-bold">
              {batteryMv} mV ({batteryPercent}%)
            </span>
          </div>
          <input
            type="range"
            min="3300"
            max="4200"
            step="10"
            value={batteryMv}
            onChange={(e) => setBatteryMv(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500">
            <span>3.30V (Cutoff)</span>
            <span>3.70V (Nominal)</span>
            <span>4.20V (Full)</span>
          </div>
        </div>

        {/* Interactive Button Simulation Guide */}
        <div className="mt-4 p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2">
          <div className="text-xs font-mono font-bold text-cyan-400 flex items-center justify-between">
            <span>TACTILE BUTTON INTERACTION</span>
            <span className="text-[10px] text-slate-400 font-normal">GPIO 10 INPUT_PULLUP</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                const next = getNextSlot(currentSlot, 3);
                onSlotChange(next);
                addLog(`[SIMULATOR] Quick switch to Slot ${next}`, 'cyan');
              }}
              className="px-2 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs font-mono text-center"
            >
              <div className="font-bold text-white">Click (&lt;0.5s)</div>
              <div className="text-[10px] text-slate-400">Next Slot</div>
            </button>
            <button
              onClick={() => {
                if (fsmState === 'PORTAL') {
                  setFsmState('PLAYBACK');
                  addLog('[SIMULATOR] Exited Portal mode', 'info');
                } else {
                  setFsmState('PORTAL');
                  onOpenPortal();
                  addLog('[SIMULATOR] Entered Portal mode (192.168.4.1)', 'crimson');
                }
              }}
              className="px-2 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs font-mono text-center"
            >
              <div className="font-bold text-cyan-400">Hold 2.5s</div>
              <div className="text-[10px] text-slate-400">Wi-Fi Portal</div>
            </button>
            <button
              onClick={() => {
                setFsmState('LOW_POWER_SLEEP');
                addLog('[SIMULATOR] Triggered Low-Power Sleep', 'crimson');
              }}
              className="px-2 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-xs font-mono text-center"
            >
              <div className="font-bold text-rose-400">Hold 5.0s</div>
              <div className="text-[10px] text-slate-400">Sleep Mode</div>
            </button>
          </div>
        </div>

        {/* Live ESP32 Serial Console Monitor */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1.5">
            <span>UART SERIAL MONITOR (115200 baud)</span>
            <button
              onClick={() => addLog('[SERIAL] Cleared console buffer', 'info')}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          </div>
          <div className="h-32 bg-black/90 p-2.5 rounded-lg border border-slate-800 font-mono text-[11px] overflow-y-auto space-y-1">
            {logs.map((log, index) => (
              <div key={index} className="text-slate-300 leading-tight">
                <span className="text-slate-600 select-none mr-1">&gt;</span>
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
