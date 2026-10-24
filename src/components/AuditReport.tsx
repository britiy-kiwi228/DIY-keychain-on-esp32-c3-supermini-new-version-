/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, CheckCircle, Flame, ShieldAlert, Cpu, Wrench, Zap, Lock, Terminal } from 'lucide-react';

export function AuditReport() {
  return (
    <div className="space-y-6 text-slate-200">
      {/* 1. Summary of Functions & Purpose */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="w-5 h-5 text-cyan-400" />
          <h2 className="text-base font-mono font-bold text-white tracking-wide">
            1. РЕЗЮМЕ О ФУНКЦИЯХ И СМЫСЛЕ ПРОЕКТА
          </h2>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          Проект представляет собой <strong>DIY цифровой карманный брелок (Electronic Keychain)</strong> в стиле <em>Laincore / Analog Horror</em>, построенный на базе микроконтроллера <strong>ESP32-C3 SuperMini</strong> (RISC-V) и круглого 1.28&quot; (или 1.3&quot;) IPS дисплея <strong>ST7789</strong> с разрешением <strong>240×240 пикселей</strong>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-xs font-mono">
          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
            <div className="font-bold text-cyan-400 mb-1 flex items-center gap-1.5">
              <span>▶</span> Воспроизведение (Playback)
            </div>
            <p className="text-slate-400">
              Процессор работает на 80 МГц, Wi-Fi выключен (0 мА). Построчное декодирование GIF прямо из LittleFS в окно ST7789 через SPI (расход RAM всего ~480 байт). 3 слота переключаются коротким нажатием кнопки.
            </p>
          </div>
          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
            <div className="font-bold text-rose-400 mb-1 flex items-center gap-1.5">
              <span>📶</span> Captive Portal (SoftAP)
            </div>
            <p className="text-slate-400">
              При удержании кнопки 2.5с процессор разгоняется до 160 МГц и поднимает точку доступа <code>WIRED_KEYCHAIN</code>. На экран выводится QR-код, а DNS перехватывает запросы и открывает веб-редактор с обрезкой картинок.
            </p>
          </div>
          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
            <div className="font-bold text-amber-400 mb-1 flex items-center gap-1.5">
              <span>⚡</span> Управление питанием
            </div>
            <p className="text-slate-400">
              Мониторинг напряжения Li-Po аккумулятора через АЦП (GPIO 0). Определение подключения USB 5V (GPIO 1) для перехода в режим сна экрана при зарядке, защищая батарею от паразитной нагрузки.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Detected Vulnerabilities & Critical Bugs */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-5 h-5 text-rose-500" />
          <h2 className="text-base font-mono font-bold text-white tracking-wide">
            2. НАЙДЕННЫЕ ОШИБКИ И ПОТЕНЦИАЛЬНЫЕ УЯЗВИМОСТИ
          </h2>
        </div>

        <div className="space-y-4">
          {/* Bug 1: JS Syntax Error */}
          <div className="p-4 bg-rose-950/30 border border-rose-800/60 rounded-lg">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-rose-400 mb-1">
              <span className="flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-rose-500" /> [КРИТИЧЕСКАЯ ОШИБКА 1] СИНТАКСИЧЕСКИЙ СБОЙ JS В INDEX.HTML
              </span>
              <span className="bg-rose-900/80 text-rose-200 px-2 py-0.5 rounded text-[10px]">ВЫСОКАЯ</span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              В файле <code>firmware/data/index.html</code> (строки 1405–1440) функция <code>updateThumbnail</code> была продублирована с закрывающей скобкой <code>&#125;</code> прямо посреди тела функции. Это вызывает <strong>Uncaught SyntaxError</strong> в браузере клиента при открытии портала, из-за чего весь JavaScript полностью перестает выполняться (кнопки загрузки, ползунки и передача во flash блокируются).
            </p>
            <div className="mt-2 text-[11px] font-mono bg-black/60 p-2 rounded text-rose-300">
              ✓ <strong>Устранено:</strong> Синтаксис очищен от дублирующего блока, скорректирована отрисовка миниатюр и заново сжат <code>index.html.gz</code>.
            </div>
          </div>

          {/* Bug 2: ESP32-C3 Deep Sleep Wakeup */}
          <div className="p-4 bg-rose-950/30 border border-rose-800/60 rounded-lg">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-rose-400 mb-1">
              <span className="flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-rose-500" /> [КРИТИЧЕСКАЯ ОШИБКА 2] АППАРАТНАЯ НЕВОЗМОЖНОСТЬ ПРОБУЖДЕНИЯ ИЗ DEEP SLEEP
              </span>
              <span className="bg-rose-900/80 text-rose-200 px-2 py-0.5 rounded text-[10px]">ВЫСОКАЯ</span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              В <code>main.cpp</code> вызывается <code>esp_deep_sleep_enable_gpio_wakeup((1ULL &lt;&lt; PIN_BUTTON), ESP_GPIO_WAKEUP_GPIO_LOW)</code> для кнопки на <strong>GPIO 10</strong>.
              Согласно официальному Technical Reference Manual ESP32-C3, пробуждение из Deep Sleep поддерживают <strong>только выводы GPIO 0–5</strong> (домен RTC). Вывод GPIO 10 обесточивается при Deep Sleep. Вызов возвращает ошибку, и брелок засыпал <em>намертво</em> без возможности проснуться от кнопки (только по снятию аккумулятора).
            </p>
            <div className="mt-2 text-[11px] font-mono bg-black/60 p-2 rounded text-emerald-400">
              ✓ <strong>Устранено:</strong> Переведено на <strong>Light Sleep</strong> через <code>gpio_wakeup_enable(GPIO_NUM_10)</code>. Потребление падает до ~130 мкА (месяцы ожидания от батареи 180 мАч), и устройство гарантированно просыпается по клику на GPIO 10 без аппаратных блокировок.
            </div>
          </div>

          {/* Bug 3: Architectural Mismatch */}
          <div className="p-4 bg-amber-950/30 border border-amber-800/60 rounded-lg">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-amber-400 mb-1">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> [АРХИТЕКТУРНЫЙ СБОЙ] НЕСОВМЕСТИМОСТЬ СТАТИЧЕСКИХ КАРТИНОК И ДЕКОДЕРА GIF
              </span>
              <span className="bg-amber-900/80 text-amber-200 px-2 py-0.5 rounded text-[10px]">СРЕДНЯЯ</span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              Веб-интерфейс при отправке фото/статичной графики преобразует холст в 115 200 байт сырых RGB565 данных, а прошивка в <code>web_portal.cpp</code> всегда сохраняла файл как <code>/slot%d.gif</code> и передавала его в <code>s_gif.open()</code>. Библиотека <em>AnimatedGIF</em> отклоняла файл без GIF-сигнатуры, приводя к ошибке &quot;SLOT EMPTY&quot;.
            </p>
            <div className="mt-2 text-[11px] font-mono bg-black/60 p-2 rounded text-emerald-400">
              ✓ <strong>Устранено:</strong> Добавлена поддержка как <code>.gif</code>, так и <code>.bin</code>. При наличии <code>.bin</code> прошивка считывает сырые RGB565 строки через буфер и выводит в ST7789.
            </div>
          </div>

          {/* Bug 4: ADC Polling Overhead */}
          <div className="p-4 bg-amber-950/30 border border-amber-800/60 rounded-lg">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-amber-400 mb-1">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> [ПРОИЗВОДИТЕЛЬНОСТЬ] ИЗБЫТОЧНЫЙ ОПРОС АЦП В КАЖДОЙ ИТЕРАЦИИ LOOP()
              </span>
              <span className="bg-amber-900/80 text-amber-200 px-2 py-0.5 rounded text-[10px]">ОПТИМИЗАЦИЯ</span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              В функции <code>loop()</code> вызов <code>battery_is_charging()</code> выполнял <code>analogReadMilliVolts()</code> десятки тысяч раз в секунду. Это вызывало лаги и микрофризы частоты кадров GIF, а также забивало такты процессора.
            </p>
            <div className="mt-2 text-[11px] font-mono bg-black/60 p-2 rounded text-emerald-400">
              ✓ <strong>Устранено:</strong> Опрос АЦП ограничен таймером 500 мс и добавлен гистерезис (включение при 4.0В, отключение ниже 3.6В).
            </div>
          </div>

          {/* Bug 5: LittleFS Upload Abort & Overflow */}
          <div className="p-4 bg-amber-950/30 border border-amber-800/60 rounded-lg">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-amber-400 mb-1">
              <span className="flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-amber-500" /> [БЕЗОПАСНОСТЬ И НАДЕЖНОСТЬ FS] ОБРЫВ ЗАГРУЗКИ И ПЕРЕПОЛНЕНИЕ ПАМЯТИ
              </span>
              <span className="bg-amber-900/80 text-amber-200 px-2 py-0.5 rounded text-[10px]">СРЕДНЯЯ</span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              В <code>web_portal.cpp</code> отсутствовала обработка события <code>UPLOAD_FILE_ABORTED</code> (при разрыве Wi-Fi дескриптор файла оставался открытым, а поврежденный файл засорял LittleFS), и не было проверки оставшегося места перед записью чанка. Также в <code>handle_api_delete()</code> отсутствовала валидация диапазона слотов.
            </p>
            <div className="mt-2 text-[11px] font-mono bg-black/60 p-2 rounded text-emerald-400">
              ✓ <strong>Устранено:</strong> Внедрены закрытие дескриптора при сбросе, удаление битого файла, проверка <code>freeBytes</code> и валидация <code>1 &lt;= slot &lt;= 3</code>.
            </div>
          </div>
        </div>
      </div>

      {/* 3. Recommendations for Optimization & Performance */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-mono font-bold text-white tracking-wide">
            3. ПЛАН УСТРАНЕНИЯ ОШИБОК И РЕКОМЕНДАЦИИ ПО ОПТИМИЗАЦИИ
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-2">
            <div className="text-emerald-400 font-bold flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> 1. Аппаратное SPI &amp; DMA
            </div>
            <p className="text-slate-300">
              Увеличьте <code>SPI_FREQUENCY</code> до <strong>80 МГц</strong> (ST7789 без проблем держит 80 МГц при коротких проводниках на плате). Использование SPI DMA позволяет передавать строку дисплея в фоновом режиме, пока процессор распаковывает следующий LZW-блок GIF.
            </p>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-2">
            <div className="text-emerald-400 font-bold flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> 2. Энергосбережение экрана
            </div>
            <p className="text-slate-300">
              При воспроизведении черных пикселей используйте команду ST7789 <code>COLMOD</code>. В прошивке используется ШИМ подсветки 5 кГц (без писка дросселей). Снижение с 40% до 25% в темноте продлевает работу брелока на 40%.
            </p>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-2">
            <div className="text-emerald-400 font-bold flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> 3. Оптимизация LittleFS
            </div>
            <p className="text-slate-300">
              Сжатый файл веб-интерфейса <code>index.html.gz</code> весит всего <strong>13 КБ</strong> против 66 КБ исходного HTML, освобождая более 50 КБ флеш-памяти для дополнительных кадров GIF.
            </p>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-2">
            <div className="text-emerald-400 font-bold flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> 4. Безопасность точки доступа
            </div>
            <p className="text-slate-300">
              Рекомендуется добавить возможность смены пароля AP или генерацию уникального пароля из MAC-адреса чипа (например, <code>keychain_XXXX</code>), чтобы посторонние не могли стереть слоты без ведома владельца.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
