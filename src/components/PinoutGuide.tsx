/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Cpu, Zap, Battery, Monitor, CircleDot } from 'lucide-react';

export function PinoutGuide() {
  const pinRows = [
    { espPin: 'GPIO 4', func: 'TFT_SCLK', target: 'ST7789 SCL', type: 'SPI Clock', note: 'Аппаратный SPI до 80 МГц' },
    { espPin: 'GPIO 6', func: 'TFT_MOSI', target: 'ST7789 SDA', type: 'SPI Data', note: 'Линия передачи данных DMA' },
    { espPin: 'GPIO 7', func: 'TFT_CS', target: 'ST7789 CS', type: 'Chip Select', note: 'Выбор ведомого дисплея' },
    { espPin: 'GPIO 5', func: 'TFT_DC', target: 'ST7789 DC', type: 'Command/Data', note: 'Переключение данных/команд' },
    { espPin: 'GPIO 3', func: 'TFT_RST', target: 'ST7789 RES', type: 'Reset', note: 'Аппаратный сброс контроллера' },
    { espPin: 'GPIO 2', func: 'TFT_BLK', target: 'ST7789 BLK', type: 'LEDC PWM', note: 'ШИМ подсветка 5 кГц (без писка)' },
    { espPin: 'GPIO 10', func: 'PIN_BUTTON', target: 'Тактовая кнопка', type: 'Digital IN (Pull-up)', note: 'Замыкание на GND; Light Sleep wake-up' },
    { espPin: 'GPIO 0', func: 'PIN_BAT_ADC', target: 'Делитель Li-Po (100k/100k)', type: 'ADC1_CH0', note: 'Измерение напряжения аккумулятора (* 2)' },
    { espPin: 'GPIO 1', func: 'PIN_VBUS_SENSE', target: 'Делитель USB 5V (100k/100k)', type: 'ADC1_CH1', note: 'Детектор зарядки через VBUS' },
    { espPin: '3.3V', func: 'VCC', target: 'Питание ST7789 & ESP32', type: 'Power Out', note: 'Стабилизированные 3.3В от LDO платы' },
    { espPin: 'GND', func: 'GROUND', target: 'Общий провод', type: 'Ground', note: 'Единая земля всех модулей' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-5">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
        <Monitor className="w-5 h-5 text-cyan-400" />
        <h2 className="text-base font-mono font-bold text-white tracking-wide">
          АППАРАТНАЯ РАСПИНОВКА И СХЕМА ПОДКЛЮЧЕНИЯ (ESP32-C3 SUPERMINI)
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs border-collapse">
          <thead>
            <tr className="bg-slate-950/80 text-cyan-400 border-b border-slate-800">
              <th className="py-2.5 px-3">ПИН ESP32-C3</th>
              <th className="py-2.5 px-3">ИМЯ МАКРОСА</th>
              <th className="py-2.5 px-3">МОДУЛЬ НАЗНАЧЕНИЯ</th>
              <th className="py-2.5 px-3">ТИП СИГНАЛА</th>
              <th className="py-2.5 px-3">ОСОБЕННОСТИ И ПРИМЕЧАНИЕ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {pinRows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                <td className="py-2 px-3 font-bold text-rose-400">{row.espPin}</td>
                <td className="py-2 px-3 text-cyan-300">{row.func}</td>
                <td className="py-2 px-3 text-white">{row.target}</td>
                <td className="py-2 px-3 text-amber-400">{row.type}</td>
                <td className="py-2 px-3 text-slate-400">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assembly recommendations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg text-xs font-mono space-y-1.5">
          <div className="text-emerald-400 font-bold flex items-center gap-1.5">
            <Zap className="w-4 h-4" /> Модуль зарядки TP4056 + Li-Po батарея
          </div>
          <p className="text-slate-400">
            Используйте миниатюрный Li-Po аккумулятор 3.7В емкостью 150–250 мАч (типоразмер 402030 или 502030). Делитель напряжения на резисторах 100 кОм + 100 кОм подключен между BAT+ и GND, средняя точка на GPIO 0.
          </p>
        </div>

        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg text-xs font-mono space-y-1.5">
          <div className="text-cyan-400 font-bold flex items-center gap-1.5">
            <CircleDot className="w-4 h-4" /> 1.28&quot; Круглый ST7789 IPS дисплей
          </div>
          <p className="text-slate-400">
            Круглый экран имеет физическую круглую матрицу 240x240 пикселей. Убедитесь в отсутствии длинных висящих проводов SPI, чтобы не ловить наводки на частоте 40–80 МГц.
          </p>
        </div>
      </div>
    </div>
  );
}
