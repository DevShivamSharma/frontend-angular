# Venue clock

Scoped handoff for the Bharat Mandapam venue home screen. Preserve the existing venue identity and scene hierarchy; the planner's root design documentation does not define this surface.

## Overview

The venue follows current New Delhi time automatically and provides a small manual-time control for client demonstrations. Time is always IST (UTC+05:30), independent of the viewer's timezone. Daylight starts at 06:30 inclusive and ends at 18:30 exclusive; all other times use night lighting.

## Layout

The clock sits inside the existing appearance control, below the appearance/scenery choices. Its disclosure starts closed, showing `HH:mm IST` and `Live` or `Demo` with `Day` or `Night`. The control is right-aligned and 200px wide, reducing to 180px at widths of 700px or less. It follows the appearance control's visitor-mode hiding and loading inert state.

## Colors

The control uses a warm pale surface (#f3f0ea), dark green text (#29352f), muted supporting text (#47574d), and dark green Live/selected actions (#353c36) with white text. The time input has a warm white surface (#fffdf8). Keyboard focus uses a two-pixel brown outline (#9a623f) with a two-pixel offset.

## Typography

Use the incumbent typography. The clock uses tabular numerals at 12px, its supporting status uses 11px, and the native time input uses 14px with tabular numerals. Keep the control subordinate to the venue scene.

## Components

- The disclosure button has a 44px minimum height and exposes its expanded state and controlled panel through ARIA. The expanded panel contains a labeled, minute-resolution time input, Day (12:00), Night (21:00), and Live time actions, plus the lighting schedule explanation.
- A valid manual `HH:mm` value switches to Demo and stays fixed until Live is selected. Invalid or empty values are ignored. Day/Night presets and the existing light-toggle button use the same manual mode.
- Demo mode exposes a compact Live action even while the disclosure is closed. Either Live action immediately restores the current IST time and lighting. The expanded Live time action exposes its selected state with `aria-pressed`.
- Preset actions have a 36px minimum height, increasing to 40px on narrow screens. The time input has a 40px minimum height. The panel uses a subtle shadow and a divider above the expanded controls.

## Implementation and verification

`src/app/home/venue-clock.ts` owns IST conversion, valid time parsing, and the daylight boundary. `home-page.component.ts` initializes the clock from real time, polls every second outside Angular, and enters Angular only when the displayed minute changes or a refresh is forced. Viewer lighting updates also run outside Angular and occur only when day/night changes or a forced synchronization is requested.

Focus, page-show, and return-to-visible events resynchronize live time while preserving a fixed demo time. Starting the clock clears any previous interval; destruction clears the interval and prevents subsequent clock updates. Control markup lives in `home-page.component.html`; scoped styling lives in `venue-time.css`.

The reviewer assessed `.impeccable/review/desktop.png` (1440px) and `.impeccable/review/mobile.png` (390px) as **Ship**, with no material UI findings. The build passed. Focused Playwright checks passed for IST conversion, lighting boundaries, real browser timer updates, manual demo hold, Live reset, and desktop/mobile controls. External catalogue responses were fixtures; venue geometry and rendering were real.
