import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// NOTE: intentionally NOT using <React.StrictMode>. Strict mode double-invokes
// effects in dev, which would start/stop the webcam + MediaPipe twice and cause
// flaky camera behavior. For a PoC we want a single, predictable init.
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
