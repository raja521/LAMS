import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App.jsx';
import theme from './theme.js';
import env from './config/env.js';
import { AuthProvider } from './auth/AuthContext.jsx';
import ConfigError from './components/ConfigError.jsx';

const root = createRoot(document.getElementById('root'));

try {
  // Touching `env` here surfaces a missing VITE_* value as a clear screen
  // rather than an obscure failure somewhere deeper in the app.
  document.title = env.appName;

  root.render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </StrictMode>
  );
} catch (error) {
  root.render(<ConfigError message={error.message} />);
}
