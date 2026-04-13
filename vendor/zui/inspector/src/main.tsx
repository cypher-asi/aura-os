import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from '@cypher-asi/zui';
import '@cypher-asi/zui/styles/index.css';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" defaultAccent="cyan">
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
