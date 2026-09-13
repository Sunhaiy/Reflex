import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '../index.css';
import './website.css';
import { ReflexWebsite } from './Website';

ReactDOM.createRoot(document.getElementById('website-root')!).render(
  <React.StrictMode>
    <ReflexWebsite />
  </React.StrictMode>,
);
