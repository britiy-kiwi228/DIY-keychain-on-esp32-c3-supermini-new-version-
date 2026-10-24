#include "battery.h"
#include "config.h"

// Exponential Moving Average (EMA) state
static float s_filtered_mv = 3800.0f;
static bool  s_initialized = false;

void battery_init(void) {
    pinMode(PIN_BAT_ADC, INPUT);
    pinMode(PIN_VBUS_SENSE, INPUT);

    // Initial prime of ADC reading
    uint32_t raw_adc = analogReadMilliVolts(PIN_BAT_ADC);
    s_filtered_mv = (float)(raw_adc * 2);
    s_initialized = true;
}

uint16_t battery_get_mv(void) {
    if (!s_initialized) {
        battery_init();
    }

    // Read hardware-calibrated ADC millivolts and account for 100k / 100k divider (* 2)
    uint32_t instant_mv = analogReadMilliVolts(PIN_BAT_ADC) * 2;

    // EMA Filter: alpha = 0.15 (smooth out transient screen/radio spikes)
    const float alpha = 0.15f;
    s_filtered_mv = (alpha * (float)instant_mv) + ((1.0f - alpha) * s_filtered_mv);

    return (uint16_t)s_filtered_mv;
}

uint8_t battery_get_percentage(void) {
    uint16_t mv = battery_get_mv();

    // Standard 3.7V Li-Po discharge curve approximation
    if (mv >= 4150) return 100;
    if (mv >= 4050) return 90;
    if (mv >= 3950) return 80;
    if (mv >= 3850) return 65;
    if (mv >= 3750) return 45;
    if (mv >= 3650) return 20;
    if (mv >= 3550) return 10;
    if (mv >= 3400) return 5;
    return 0;
}

bool battery_is_charging(void) {
    static bool s_charging_state = false;
    // 5V VBUS divided by 2 (100k/100k) yields ~2.5V (2500mV raw, 5000mV computed)
    uint32_t vbus_mv = analogReadMilliVolts(PIN_VBUS_SENSE) * 2;
    
    // Hysteresis: turn on at CHARGE_VBUS_THRESHOLD_MV (3800-4000mV), turn off below 3600mV
    if (s_charging_state) {
        if (vbus_mv < 3600) s_charging_state = false;
    } else {
        if (vbus_mv >= CHARGE_VBUS_THRESHOLD_MV) s_charging_state = true;
    }
    return s_charging_state;
}
