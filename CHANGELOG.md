# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.1] - 2026-05-16

### Changed
- Wallbox layout improvements: more spacing between label and mode badge
- Charging mode labels are now nicely formatted (`MIN+PV` instead of `MINPV`, etc.)

## [5.0] - 2026-05-16

### Added
- New `pv_total_power` config option for a fast-updating PV total sensor (used for sun display and heartbeat)
- Click any element to open Home Assistant's more-info dialog
- Warning badges in header for low SOC, hot inverter, system anomalies
- EV-SOC display in wallbox card when sensor is available
- 24h PV sparkline using HA history API
- 7-day comparison showing today vs weekly average
- Sunrise/sunset times at sun arc endpoints

### Fixed
- Heartbeat now picks the freshest sensor automatically, no more false "stale" status
- House consumption trend arrow positioned with proper spacing
- Wallbox "today" line is hidden when sensor is not configured

## [4.2] - 2026-05-16

### Fixed
- Heat pump fan rotation now stays inside the icon (was rotating around wrong pivot)
- More spacing between house consumption and consumer cards

## [4.1] - 2026-05-16

### Changed
- `forecast_today` and `forecast_tomorrow` now accept lists of sensors that are summed automatically (multi-roof support)

## [4.0] - 2026-05-16

### Added
- Forecast.Solar integration with progress bar
- Economy bar with savings, feed-in, and grid cost
- Wallbox mode badge and today's charged energy
- Trend arrows for SOC and house consumption
- Status indicator showing data freshness
- Sunrise/sunset markers

## [3.2] - 2026-05-16

### Changed
- Wallbox and heat pump cards enlarged with better internal spacing

## [3.1] - 2026-05-16

### Changed
- Default grid sensor switched to `sensor.evcc_grid_power` (bipolar)
- Battery sign convention default changed to `discharge` to match evcc

## [3.0] - 2026-05-16

### Added
- Curved Bezier sun-to-inverter flow line with animated dot
- Modern SVG icons replacing emoji-style placeholders
- Wallbox and heat pump as persistent cards with status indicators
- Rotating fan animation on heat pump when active

## [2.0] - 2026-05-16

### Added
- Robust per-sensor-type unit conversion
- Proper flow animations for house and grid with direction indicators
- Animated sun moving across the sky based on azimuth/elevation
- Auto-formatting between W and kW

### Fixed
- Old "value < 25 → multiply by 1000" heuristic that broke SOC, temperature, and voltage readings
