import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastContainer } from './components/Toast';
import './styles/globals.css';

// Set theme immediately before React renders to prevent flash
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastContainer>
        <App />
      </ToastContainer>
    </BrowserRouter>
  </React.StrictMode>
);

