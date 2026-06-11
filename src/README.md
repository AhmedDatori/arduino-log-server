# Frontend Folder Map

This folder contains the React dashboard for Smart Green House.

## Main Files

- `main.jsx` starts React and mounts the app into the browser page.
- `App.jsx` loads shared dashboard data and chooses which page is visible.
- `appSections.js` defines the top navigation tabs in one place.
- `api.js` contains every browser-to-server API call.
- `utils.js` contains small display helpers for sensor status labels and colors.
- `index.css` contains app-wide styles and CSS variables.

## Folders

- `views/` contains full dashboard pages, such as Status, Camera, Plants, Reports, and AI Lab.
- `components/` contains reusable UI blocks used inside the pages, such as the header, device bar, sensor cards, controls, and AI panels.

## Simple Mental Model

The frontend works like this:

1. `App.jsx` asks the backend for logs, actuator state, alerts, plants, and mode.
2. `Header.jsx` lets the user choose a dashboard section.
3. A file from `views/` renders the selected page.
4. Components from `components/` render reusable cards, controls, and panels.
5. User actions call functions in `api.js`, which talk to the Express backend.
