/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Upload, Sparkles, Download, Layers, Sliders, Moon, Sun, ArrowRight, CheckCircle2 } from 'lucide-react';
import { rgbToRgb565 } from '../utils/keychainLogic.ts';

interface PortalEditorProps {
  currentSlot: number;
  onSlotChange: (slot: number) => void;
  onSaveToDevice: (slot: number, isGif: boolean, url: string, name: string) => void;
  addLog: (msg: string, type?: 'info' | 'success' | 'crimson' | 'cyan') => void;
  slotImages: Record<number, { isGif: boolean; url: string; name: string }>;
}

export function PortalEditor({
  currentSlot,
  onSlotChange,
  onSaveToDevice,
  addLog,
  slotImages,
}: PortalEditorProps) {
  // Theme state
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(true);

  // Sliders
  const [zoom, setZoom] = useState<number>(1.0);
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [ditherLevel, setDitherLevel] = useState<number>(1); // 0: OFF, 1: RGB565, 2: BAYER, 3: FLOYD, 4: 1-BIT
  const [filter, setFilter] = useState<'rgb565' | 'normal' | 'phosphor' | 'cyan' | 'glitch' | 'binary' | 'invert'>('rgb565');

  // Pan offset
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; initX: number; initY: number }>({ x: 0, y: 0, initX: 0, initY: 0 });

  // Uploaded media state
  const [currentMedia, setCurrentMedia] = useState<{ isGif: boolean; url: string; name: string }>({
    isGif: slotImages[currentSlot]?.isGif || false,
    url: slotImages[currentSlot]?.url || '/presets/lain_angel.jpg',
    name: slotImages[currentSlot]?.name || 'LAIN_ANGEL',
  });

  // Transfer animation state
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Update editor when currentSlot changes
  useEffect(() => {
    if (slotImages[currentSlot]) {
      setCurrentMedia(slotImages[currentSlot]);
    }
  }, [currentSlot, slotImages]);

  // Re-render canvas preview
  useEffect(() => {
    if (!canvasRef.current || currentMedia.isGif) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, 240, 240);

      const imgW = img.naturalWidth || img.width;
      const imgH = img.naturalHeight || img.height;
      const minDim = Math.min(imgW, imgH);
      const baseScale = 240 / minDim;
      const totalScale = baseScale * zoom;

      const drawW = imgW * totalScale;
      const drawH = imgH * totalScale;
      const drawX = (240 - drawW) / 2 + panX;
      const drawY = (240 - drawH) / 2 + panY;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      // Pixel-level brightness, contrast & color filter
      const imgData = ctx.getImageData(0, 0, 240, 240);
      const data = imgData.data;
      const brightnessMul = brightness / 100;
      const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        r = contrastFactor * (r * brightnessMul - 128) + 128;
        g = contrastFactor * (g * brightnessMul - 128) + 128;
        b = contrastFactor * (b * brightnessMul - 128) + 128;

        r = Math.min(255, Math.max(0, r));
        g = Math.min(255, Math.max(0, g));
        b = Math.min(255, Math.max(0, b));

        if (filter === 'rgb565') {
          r = (Math.round((r * 31) / 255) * 255) / 31;
          g = (Math.round((g * 63) / 255) * 255) / 63;
          b = (Math.round((b * 31) / 255) * 255) / 31;
        } else if (filter === 'phosphor') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = gray * 0.15;
          g = gray * 1.05;
          b = gray * 0.35;
        } else if (filter === 'cyan') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = gray * 0.1;
          g = gray * 0.95;
          b = gray * 1.05;
        } else if (filter === 'glitch') {
          r = Math.min(255, r * 1.35);
          g = g * 0.55;
          b = Math.min(255, b * 1.4);
        } else if (filter === 'binary') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const val = gray > 128 ? 255 : 0;
          r = val;
          g = val;
          b = val;
        } else if (filter === 'invert') {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }

      ctx.putImageData(imgData, 0, 0);
    };
    img.src = currentMedia.url;
  }, [currentMedia, zoom, panX, panY, brightness, contrast, filter]);

  // Handle Drag / Pan inside Round Glass
  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { x: clientX, y: clientY, initX: panX, initY: panY };
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    setPanX(dragStartRef.current.initX + dx);
    setPanY(dragStartRef.current.initY + dy);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  // Preset Selection
  const loadPreset = (presetName: string, presetPath: string) => {
    setCurrentMedia({
      isGif: false,
      url: presetPath,
      name: presetName,
    });
    setPanX(0);
    setPanY(0);
    setZoom(1.0);
    addLog(`[PORTAL] Loaded preset: ${presetName}`, 'cyan');
  };

  // Upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
      const url = URL.createObjectURL(file);

      setCurrentMedia({
        isGif,
        url,
        name: file.name.toUpperCase(),
      });
      setPanX(0);
      setPanY(0);
      setZoom(1.0);
      addLog(`[PORTAL] Uploaded ${isGif ? 'Animated GIF' : 'Static Image'}: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'success');
    }
  };

  // Transmit / Save to Device
  const handleTransmit = () => {
    if (isTransmitting) return;
    setIsTransmitting(true);
    setProgress(0);

    addLog(`[SPI DMA] Flashing Slot 0${currentSlot} with ${currentMedia.name}...`, 'crimson');

    const totalSteps = 20;
    let step = 0;
    const interval = window.setInterval(() => {
      step++;
      const currentPct = Math.min(100, Math.round((step / totalSteps) * 100));
      setProgress(currentPct);

      if (step >= totalSteps) {
        clearInterval(interval);
        setIsTransmitting(false);
        onSaveToDevice(currentSlot, currentMedia.isGif, currentMedia.url, currentMedia.name);
        addLog(`[LITTLEFS] Slot 0${currentSlot} committed: 115.2 KB written! ACK received`, 'success');
      }
    }, 60);
  };

  // Export raw .BIN (115,200 bytes RGB565)
  const handleDownloadBin = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.getImageData(0, 0, 240, 240);
    const data = imgData.data;

    const buffer = new Uint8Array(240 * 240 * 2);
    let byteIdx = 0;
    for (let i = 0; i < data.length; i += 4) {
      const enc = rgbToRgb565(data[i], data[i + 1], data[i + 2]);
      buffer[byteIdx++] = enc.highByte;
      buffer[byteIdx++] = enc.lowByte;
    }

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slot_0${currentSlot}_round240.bin`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`[EXPORT] Downloaded raw RGB565 binary: slot_0${currentSlot}_round240.bin`, 'success');
  };

  // Export C-Array .h header for Arduino / PlatformIO
  const handleDownloadHeader = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.getImageData(0, 0, 240, 240);
    const data = imgData.data;

    let header = `// ST7789 240x240 RGB565 Round Image\n#include <stdint.h>\nconst uint16_t image_slot_0${currentSlot}[57600] PROGMEM = {\n  `;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const enc = rgbToRgb565(data[i], data[i + 1], data[i + 2]);
      header += `0x${enc.value.toString(16).padStart(4, '0')}`;
      count++;
      if (count < 57600) {
        header += ', ';
        if (count % 12 === 0) header += '\n  ';
      }
    }
    header += '\n};\n';

    const blob = new Blob([header], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slot_0${currentSlot}_image.h`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`[EXPORT] Downloaded C-Array Header: slot_0${currentSlot}_image.h`, 'success');
  };

  return (
    <div className={`p-4 md:p-6 rounded-2xl border transition-colors ${
      isDarkTheme
        ? 'bg-[#090d14] border-slate-800 text-slate-100'
        : 'bg-[#e4e8ef] border-slate-300 text-slate-900'
    }`}>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="text-rose-500 font-mono font-bold tracking-wider text-sm">WIRED_KEYCHAIN</span>
          <span className="text-xs font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
            1.28&quot; ROUND CAPTIVE PORTAL (192.168.4.1)
          </span>
        </div>
        <button
          onClick={() => setIsDarkTheme(!isDarkTheme)}
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono rounded border border-slate-700 bg-slate-800 hover:bg-slate-700"
          title="Toggle UI Aesthetics"
        >
          {isDarkTheme ? <Moon className="w-3.5 h-3.5 text-cyan-400" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
          <span>{isDarkTheme ? 'DARK_TERMINAL' : 'LIGHT_DEREALIZATION'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-5">
        {/* Left Column: Round Display Canvas Preview */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center">
          {/* Bezel Frame */}
          <div className="relative w-64 h-64 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-950 p-3 shadow-2xl border-4 border-slate-600 flex items-center justify-center">
            {/* Round Screen Glass */}
            <div
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
              className="relative w-52 h-52 rounded-full overflow-hidden bg-black shadow-inner cursor-move select-none"
              title="Drag with finger or mouse to pan image inside round window"
            >
              {currentMedia.isGif ? (
                <img
                  src={currentMedia.url}
                  alt="GIF Preview"
                  className="w-full h-full object-cover rounded-full select-none"
                  style={{
                    transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                    filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                  }}
                />
              ) : (
                <canvas
                  ref={canvasRef}
                  width={240}
                  height={240}
                  className="w-full h-full rounded-full select-none"
                />
              )}

              {/* Reflection & Hud Crosshair */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-white/20 pointer-events-none" />
              <div className="absolute inset-0 rounded-full border border-dashed border-rose-500/30 pointer-events-none" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none opacity-40">
                <div className="absolute left-2 top-0 w-0.5 h-4 bg-rose-500" />
                <div className="absolute top-2 left-0 h-0.5 w-4 bg-rose-500" />
              </div>

              {/* Live Badge */}
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-mono bg-black/80 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-800 pointer-events-none whitespace-nowrap">
                {currentMedia.isGif ? '▶ ANIMATED GIF' : 'ST7789 · 240×240 CIR'}
              </span>
            </div>
          </div>

          {/* Micro Pan Status */}
          <div className="flex items-center justify-between w-64 mt-3 text-xs font-mono text-slate-400">
            <span>OFFSET: {Math.round(panX)}, {Math.round(panY)}</span>
            <button
              onClick={() => {
                setPanX(0);
                setPanY(0);
                setZoom(1.0);
              }}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 text-[10px]"
            >
              CENTER
            </button>
          </div>
        </div>

        {/* Right Column: Editing Controls & Injection */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          {/* Memory Slots Switcher */}
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((slot) => (
              <button
                key={slot}
                onClick={() => {
                  onSlotChange(slot);
                  addLog(`[PORTAL] Switched active editing target to Slot 0${slot}`, 'cyan');
                }}
                className={`p-2 rounded-lg border font-mono text-xs flex flex-col items-center gap-1 transition-all ${
                  currentSlot === slot
                    ? 'bg-cyan-950/60 border-cyan-400 text-white shadow-md'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <Layers className="w-3.5 h-3.5" />
                  SLOT 0{slot}
                </div>
                <span className="text-[10px] text-cyan-400 truncate max-w-[90px]">
                  {slotImages[slot]?.name || 'EMPTY'}
                </span>
              </button>
            ))}
          </div>

          {/* Upload and Presets */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-dashed border-rose-500 rounded-lg text-xs font-mono font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Upload className="w-4 h-4 text-rose-400" />
                <span>UPLOAD GIF / IMAGE</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/gif, image/webp"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            {/* Laincore Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-500 mr-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-cyan-400" /> PRESETS:
              </span>
              <button
                onClick={() => loadPreset('LAIN_ANGEL', '/presets/lain_angel.jpg')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono rounded border border-slate-700 text-slate-300"
              >
                АНГЕЛ
              </button>
              <button
                onClick={() => loadPreset('OCULAR_PCB', '/presets/ocular_pcb.jpg')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono rounded border border-slate-700 text-slate-300"
              >
                ОКУЛЯР
              </button>
              <button
                onClick={() => loadPreset('WIRE_ANGEL', '/presets/wire_angel.jpg')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono rounded border border-slate-700 text-slate-300"
              >
                ПРОВОДА
              </button>
              <button
                onClick={() => loadPreset('GLITCH_SHRINE', '/presets/glitch_shrine.jpg')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-mono rounded border border-slate-700 text-slate-300"
              >
                СОБОР
              </button>
            </div>
          </div>

          {/* The 4 Sliders Quad Grid: Scale, Brightness, Contrast, Dithering */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
            {/* Zoom */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-400">SCALE:</span>
                <span className="text-rose-400 font-bold">{zoom.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full h-1 bg-slate-800 appearance-none rounded cursor-pointer accent-rose-500"
              />
            </div>

            {/* Brightness */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-400">BRIGHTNESS:</span>
                <span className="text-rose-400 font-bold">{brightness}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="180"
                step="5"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-full h-1 bg-slate-800 appearance-none rounded cursor-pointer accent-rose-500"
              />
            </div>

            {/* Contrast */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-400">CONTRAST:</span>
                <span className="text-rose-400 font-bold">{contrast}%</span>
              </div>
              <input
                type="range"
                min="40"
                max="200"
                step="5"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
                className="w-full h-1 bg-slate-800 appearance-none rounded cursor-pointer accent-rose-500"
              />
            </div>

            {/* Dither */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-400">DITHER:</span>
                <span className="text-rose-400 font-bold">
                  {['OFF', 'RGB565', 'BAYER', 'FLOYD', '1-BIT'][ditherLevel]}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                value={ditherLevel}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setDitherLevel(val);
                  if (val === 4) setFilter('binary');
                  else if (val === 0) setFilter('normal');
                  else setFilter('rgb565');
                }}
                className="w-full h-1 bg-slate-800 appearance-none rounded cursor-pointer accent-rose-500"
              />
            </div>
          </div>

          {/* Color Filter Chips */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'rgb565', label: 'RGB565' },
              { id: 'normal', label: 'ORIGINAL' },
              { id: 'phosphor', label: 'PHOSPHOR' },
              { id: 'cyan', label: 'CYBER CYAN' },
              { id: 'glitch', label: 'GLITCH' },
              { id: 'binary', label: '1-BIT B/W' },
              { id: 'invert', label: 'INVERT' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as any)}
                className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                  filter === f.id
                    ? 'bg-cyan-500 text-black border-cyan-400 font-bold'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-500'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Transmit Action Button */}
          <div className="pt-2">
            <button
              onClick={handleTransmit}
              disabled={isTransmitting}
              className={`w-full py-3 px-4 rounded-xl font-mono text-xs font-bold tracking-widest uppercase flex items-center justify-center gap-2 border transition-all ${
                isTransmitting
                  ? 'bg-rose-950/80 border-rose-500 text-rose-300 cursor-wait'
                  : 'bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white border-blue-500 shadow-lg hover:shadow-cyan-500/20'
              }`}
            >
              {isTransmitting ? (
                <>
                  <span className="w-3 h-3 rounded-full border-2 border-rose-400 border-t-transparent animate-spin" />
                  <span>BURST FLASH (DMA SPI) {progress}%...</span>
                </>
              ) : (
                <>
                  <span>[ INJECT TO KEYCHAIN SLOT 0{currentSlot} ]</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Direct File Export links */}
          <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-slate-400 border-t border-slate-800">
            <button
              onClick={handleDownloadBin}
              className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT RAW .BIN (115.2 KB)</span>
            </button>
            <button
              onClick={handleDownloadHeader}
              className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT .H (C-ARRAY)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
