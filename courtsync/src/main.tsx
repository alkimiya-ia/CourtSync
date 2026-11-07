import { getLanguage } from './lib/i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

document.documentElement.lang = getLanguage();
if (localStorage.getItem('courtsync:sun') === '1') document.documentElement.classList.add('sun');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
