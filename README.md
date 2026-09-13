# Ortona

A real-time tactical battle set in Ortona, December 1943: the 1st Canadian
Infantry Division against 1. Fallschirmjäger-Division, fought street by street
through a rain-soaked Adriatic town.

One HTML file. No engine, no dependencies, no build step, no network. Custom
WebGL2 renderer, procedural models and textures, and a map editor built in.
Plays with mouse and keyboard on desktop, and with touch on a phone.

## Play

Open `ortona.html` in a browser. That is the whole thing.

Pick a side, pick an opposition level, deploy. Take and hold the three victory
sectors. Left-click selects, right-click moves or attacks, `Q`+click is
attack-move, `WASD` or the screen edge scrolls, the wheel zooms, `Z`/`C`
rotates. On a phone: tap to select, long press for orders, pinch to zoom, drag
to pan.

## Develop

`ortona.html` is the source. Editing it is the whole workflow.

```sh
npm install        # dev tooling only; the game needs none of it
npm run verify     # lint plus a headless smoke test on desktop and phone
npm run shoot -- --list
```

`tools/shoot.mjs` drives the game in headless Chromium and writes PNGs to
`shots/`, including model galleries for every unit, vehicle and building. See
`CLAUDE.md` for the architecture, the conventions and the rules that keep the
game to one file.
