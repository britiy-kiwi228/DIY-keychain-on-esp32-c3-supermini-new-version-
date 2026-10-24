#pragma once
#include <Arduino.h>

/**
 * ============================================================================
 * BATTERY & CHARGING TELEMETRY MODULE
 * Procedural C-style interface for Li-Po voltage measurement & USB sense.
 * ============================================================================
 */

#ifdef __cplusplus
extern "C" {
#endif

void     battery_init(void);
uint16_t battery_get_mv(void);
uint8_t  battery_get_percentage(void);
bool     battery_is_charging(void);

#ifdef __cplusplus
}
#endif
