# RoxXor-PV-Card

A modern, comprehensive energy flow card for Home Assistant. Visualizes PV production, battery storage, grid exchange, and consumer devices (wallbox, heat pump) in a single animated overview.

**Features:**
- Live flow animations between PV, battery, grid, and house
- Animated sun tracking real solar position
- Three PV strings with individual readings
- Forecast.Solar integration with daily progress bar
- 24h sparkline and 7-day comparison
- Wallbox and heat pump cards with mode indicators
- Economy tracking (savings, feed-in, cost)
- Warning system for critical states
- Click any element for more-info popup

**Resource configuration:**
```yaml
url: /hacsfiles/roxxor-pv-card/roxxor-pv-card.js
type: module
```

See [README](https://github.com/RoxXorPro/roxxor-pv-card) for full documentation.
